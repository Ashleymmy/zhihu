import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { db, rows, withTransaction } from '../../../db';
import type { AuthUser } from '../../../types';
import { assertDataScope } from '../../../core/accounts';
import { dutyAllows } from '../../../core/duties';
import { AppError } from '../../../middleware/errors';
import { writeAudit } from '../../../services/audit.service';
import { planAccountSql } from './plan-account';
import { riskList, uploadRiskImage, sendRiskReport, RiskRejectedError, riskFilters } from '../zhihu/risk';
import { isRole, isStaffRole, effectiveDuty } from '../../../auth/roles';

export const scopeSchema = z.object({ projectId: z.string().regex(/^\d+$/), accountId: z.string().regex(/^\d+$/) });
type Scope = z.infer<typeof scopeSchema>;
type RiskAccess = 'management' | 'personal';
type RiskScreenshot = Pick<Express.Multer.File, 'buffer' | 'mimetype' | 'size'>;
const url = z
  .string()
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), '请填写网页链接');
export const reportSchema = z
  .object({
    compositionId: z.string().regex(/^\d+$/),
    keyword: z.string().trim().min(1).max(128),
    riskType: z.number().int().min(1).max(2),
    riskUrl: url.optional(),
    damageKeyword: z.string().trim().max(128).optional(),
    imageIds: z.array(z.string().uuid()).min(1).max(3),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.riskType === 2 && !value.riskUrl)
      ctx.addIssue({ code: 'custom', path: ['riskUrl'], message: '举报搬运词需要填写风险链接' });
    if (new Set(value.imageIds).size !== value.imageIds.length)
      ctx.addIssue({ code: 'custom', path: ['imageIds'], message: '截图不能重复' });
  });
type ReportInput = z.infer<typeof reportSchema>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireRiskManager(user: AuthUser) {
  if (!['admin', 'developer'].includes(user.role) || !dutyAllows(user, 'operations'))
    throw new AppError(403, 40301, '风险举报仅向运营岗位管理员和开发者开放');
}
export function requireRiskParticipant(user: AuthUser) {
  if (!isRole(user.role) || effectiveDuty(user) === 'finance')
    throw new AppError(403, 40301, '当前账号无法提交内容举报');
}
export async function authorizeRisk(user: AuthUser, scope: Scope, access: RiskAccess = 'management') {
  if (access === 'personal') requireRiskParticipant(user);
  else requireRiskManager(user);
  const account = await assertDataScope(user, scope.projectId, scope.accountId, 'zhihu');
  // The current upstream client has one server credential. Never borrow it for another account.
  if (account.accountKey !== 'legacy') throw new AppError(409, 40901, '此项目尚未接通知乎举报服务，请选择已接通的项目');
}
async function riskLock(c: PoolConnection, scope: Scope, user: AuthUser, access: RiskAccess) {
  const [[account]] = await c.query<RowDataPacket[]>(
    `SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id JOIN projects p ON p.id=pi.project_id
    WHERE a.id=? AND pi.project_id=? AND a.module_id='zhihu' AND a.account_key='legacy' AND a.status='active' AND p.is_enabled=1 FOR UPDATE`,
    [scope.accountId, scope.projectId],
  );
  if (!account) throw new AppError(403, 40301, '项目或知乎服务已停用，请刷新页面');
  await liveActor(c, user, access);
  if (access === 'personal' && !isStaffRole(user.role)) {
    const [[member]] = await c.query<RowDataPacket[]>(
      'SELECT id FROM project_members WHERE project_id=? AND user_id=? AND left_at IS NULL FOR SHARE',
      [scope.projectId, user.sub],
    );
    if (!member) throw new AppError(403, 40301, '项目授权已变化，请返回首页刷新');
  }
}
async function liveActor(c: PoolConnection, user: AuthUser, access: RiskAccess) {
  const [[actor]] = await c.query<RowDataPacket[]>('SELECT role,admin_duty,is_active FROM users WHERE id=? FOR SHARE', [
    user.sub,
  ]);
  if (!actor || !actor.is_active || actor.role !== user.role) throw new AppError(403, 40301, '权限已变化，请重新登录');
  const current = { ...user, role: actor.role, adminDuty: actor.admin_duty };
  if (access === 'personal') requireRiskParticipant(current);
  else requireRiskManager(current);
}
const eligible = `c.sync_status='synced' AND c.zhihu_composition_id IS NOT NULL AND c.zhihu_composition_id<>''`;
export async function riskWorks(
  user: AuthUser, scope: Scope, search: string, page: number, access: RiskAccess = 'management',
) {
  await authorizeRisk(user, scope, access);
  const list = await rows<RowDataPacket>(
    `SELECT CAST(c.id AS CHAR) id,p.keyword,c.title,c.promo_url workUrl,u.display_name executorName
    FROM compositions c JOIN plans p ON p.id=c.plan_id LEFT JOIN users u ON u.id=c.owner_id
    WHERE p.project_id=? AND ${planAccountSql()}=? AND ${eligible} ${access === 'personal' ? 'AND c.owner_id=?' : ''}
    AND (p.keyword LIKE ? OR c.title LIKE ? OR u.display_name LIKE ?) ORDER BY c.id DESC LIMIT 21 OFFSET ?`,
    [
      scope.projectId, scope.accountId, ...(access === 'personal' ? [user.sub] : []),
      ...Array(3).fill('%' + search + '%'), (page - 1) * 20,
    ],
  );
  return { list: list.slice(0, 20), hasNext: list.length > 20 };
}
export async function listRisk(user: AuthUser, scope: Scope, filters: z.infer<typeof riskFilters>) {
  await authorizeRisk(user, scope);
  return riskList(filters);
}
export async function riskImage(user: AuthUser, scope: Scope, file?: RiskScreenshot, access: RiskAccess = 'management') {
  await authorizeRisk(user, scope, access);
  if (!file || file.size === 0 || file.size > 2 * 1024 * 1024)
    throw new AppError(422, 42201, '请选择不超过 2 MB 的截图');
  const png = file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255;
  if (!((png && file.mimetype === 'image/png') || (jpeg && file.mimetype === 'image/jpeg')))
    throw new AppError(422, 42201, '截图仅支持真实的 PNG 或 JPEG 图片');
  const token = await uploadRiskImage(file),
    id = randomUUID();
  await withTransaction(async (c) => {
    await riskLock(c, scope, user, access);
    await c.query(
      'INSERT INTO zh_risk_images(id,project_id,account_id,actor_id,file_hash,file_token) VALUES(?,?,?,?,?,?)',
      [id, scope.projectId, scope.accountId, user.sub, createHash('sha256').update(file.buffer).digest('hex'), token],
    );
    await writeAudit(
      {
        userId: user.sub,
        action: 'zhihu.risk.image',
        resourceType: 'zh_risk_image',
        resourceId: id,
        detail: { projectId: scope.projectId, accountId: scope.accountId, size: file.size },
      },
      c,
    );
  });
  return { id };
}
function publicReport(row: RowDataPacket) {
  return {
    id: String(row.id),
    keyword: String(row.keyword),
    riskType: Number(row.risk_type),
    status: row.status === 'sending' && Number(row.stale) ? 'unknown' : String(row.status),
    message: String(row.message),
    attempt: Number(row.attempt),
    createdAt: row.created_at,
  };
}
const reportSelect = 'SELECT *,updated_at<DATE_SUB(NOW(),INTERVAL 60 SECOND) stale FROM zh_risk_reports';
export async function riskHistory(user: AuthUser, scope: Scope, page: number, access: RiskAccess = 'management') {
  await authorizeRisk(user, scope, access);
  const list = await rows<RowDataPacket>(
    reportSelect + ` WHERE project_id=? AND account_id=? ${access === 'personal' ? 'AND actor_id=?' : ''} ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?`,
    [scope.projectId, scope.accountId, ...(access === 'personal' ? [user.sub] : []), (page - 1) * 20],
  );
  return { list: list.slice(0, 20).map(publicReport), hasNext: list.length > 20 };
}
async function prepare(c: PoolConnection, scope: Scope, input: ReportInput, actorId: string, access: RiskAccess) {
  const [[work]] = await c.query<RowDataPacket[]>(
    `SELECT c.zhihu_composition_id,p.keyword FROM compositions c JOIN plans p ON p.id=c.plan_id
    WHERE c.id=? AND p.project_id=? AND ${planAccountSql()}=? AND ${eligible} ${access === 'personal' ? 'AND c.owner_id=?' : ''} FOR SHARE`,
    [input.compositionId, scope.projectId, scope.accountId, ...(access === 'personal' ? [actorId] : [])],
  );
  if (!work) throw new AppError(422, 42201, '作品尚未成功提交知乎，或不属于当前项目，请重新选择');
  const images: RowDataPacket[] = [];
  for (const id of input.imageIds) {
    const [[image]] = await c.query<RowDataPacket[]>(
      'SELECT * FROM zh_risk_images WHERE id=? AND project_id=? AND account_id=? AND actor_id=? AND created_at>DATE_SUB(NOW(),INTERVAL 24 HOUR) FOR SHARE',
      [id, scope.projectId, scope.accountId, actorId],
    );
    if (!image) throw new AppError(422, 42201, '截图已过期或不可使用，请由原提交人重新上传');
    images.push(image);
  }
  const damageKeyword = access === 'personal' ? String(work.keyword) : input.damageKeyword;
  const payload = {
    keyword: input.keyword,
    risk_type: input.riskType,
    composition_id: String(work.zhihu_composition_id),
    image_tokens: images.map((i) => i.file_token).join(','),
    ...(input.riskUrl ? { risk_url: input.riskUrl } : {}),
    ...(damageKeyword ? { damage_keyword: damageKeyword } : {}),
  };
  const contentHash = hash({ ...payload, image_tokens: images.map((i) => String(i.file_hash)).sort() });
  return { payload, contentHash };
}
async function deliver(user: AuthUser, scope: Scope, id: string, attempt: number, payload: Record<string, unknown>) {
  let status = 'submitted',
    message = '已提交知乎，等待审核';
  try {
    await sendRiskReport(payload);
  } catch (e) {
    if (e instanceof RiskRejectedError) {
      status = 'failed';
      message = '知乎未接受本次举报，请核对作品、风险词和截图后重试';
    } else {
      status = 'unknown';
      message = '暂时无法确认知乎是否收到，请先查询举报结果；核实未收到后再重试';
    }
  }
  await withTransaction(async (c) => {
    await c.query("UPDATE zh_risk_reports SET status=?,message=? WHERE id=? AND attempt=? AND status='sending'", [
      status,
      message,
      id,
      attempt,
    ]);
    await writeAudit(
      {
        userId: user.sub,
        action: 'zhihu.risk.submit-result',
        resourceType: 'zh_risk_report',
        resourceId: id,
        detail: { ...scope, status, attempt },
      },
      c,
    );
  });
  const [record] = await rows<RowDataPacket>(reportSelect + ' WHERE id=?', [id]);
  return publicReport(record);
}
export async function submitRisk(
  user: AuthUser, scope: Scope, key: string, input: ReportInput, access: RiskAccess = 'management',
) {
  await authorizeRisk(user, scope, access);
  const requestHash = hash(input);
  const existing = await rows<RowDataPacket>(reportSelect + ' WHERE account_id=? AND actor_id=? AND request_key=?', [
    scope.accountId,
    user.sub,
    key,
  ]);
  if (existing.length) {
    if (existing[0].request_hash !== requestHash || String(existing[0].project_id) !== scope.projectId)
      throw new AppError(409, 40901, '提交内容已变化，请重新打开举报表单');
    return publicReport(existing[0]);
  }
  const reserved = await withTransaction(async (c) => {
    await riskLock(c, scope, user, access);
    const { payload, contentHash } = await prepare(c, scope, input, user.sub, access),
      id = randomUUID();
    await c.query(
      `INSERT INTO zh_risk_reports(id,project_id,account_id,actor_id,request_key,request_hash,content_hash,composition_id,upstream_composition_id,keyword,risk_type,payload_json,status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'sending') ON DUPLICATE KEY UPDATE id=id`,
      [
        id,
        scope.projectId,
        scope.accountId,
        user.sub,
        key,
        requestHash,
        contentHash,
        input.compositionId,
        payload.composition_id,
        input.keyword,
        input.riskType,
        JSON.stringify(input),
      ],
    );
    const [[record]] = await c.query<RowDataPacket[]>(
      reportSelect +
        ' WHERE account_id=? AND ((actor_id=? AND request_key=?) OR (project_id=? AND content_hash=?)) ORDER BY (request_key=?) DESC LIMIT 1 FOR UPDATE',
      [scope.accountId, user.sub, key, scope.projectId, contentHash, key],
    );
    if (
      String(record.actor_id)===user.sub && String(record.request_key).toLowerCase()===key.toLowerCase() &&
      (record.request_hash !== requestHash || String(record.project_id) !== scope.projectId)
    )
      throw new AppError(409, 40901, '提交内容已变化，请重新打开举报表单');
    if (record.id !== id) {
      if (access === 'personal' && String(record.actor_id) !== user.sub)
        throw new AppError(409, 40901, '相同内容已提交，请更换举报资料或查看已有结果');
      // Refresh expired evidence without sending; an uncertain result still requires explicit review before retry.
      if (['failed', 'unknown'].includes(publicReport(record).status) && String(record.actor_id) === user.sub) {
        await c.query('UPDATE zh_risk_reports SET payload_json=?,status=? WHERE id=?', [
          JSON.stringify(input),
          publicReport(record).status,
          record.id,
        ]);
        await writeAudit(
          {
            userId: user.sub,
            action: 'zhihu.risk.replace-evidence',
            resourceType: 'zh_risk_report',
            resourceId: String(record.id),
            detail: { ...scope, imageCount: input.imageIds.length },
          },
          c,
        );
      }
      return { record };
    }
    await writeAudit(
      {
        userId: user.sub,
        action: 'zhihu.risk.submit',
        resourceType: 'zh_risk_report',
        resourceId: id,
        detail: {
          ...scope,
          compositionId: input.compositionId,
          keyword: input.keyword,
          riskType: input.riskType,
          imageCount: input.imageIds.length,
        },
      },
      c,
    );
    return { record, payload };
  });
  return reserved.payload
    ? deliver(user, scope, String(reserved.record.id), 1, reserved.payload)
    : publicReport(reserved.record);
}
export async function retryRisk(
  user: AuthUser, scope: Scope, id: string, attempt: number, checked: boolean, access: RiskAccess = 'management',
) {
  await authorizeRisk(user, scope, access);
  const reserved = await withTransaction(async (c) => {
    await riskLock(c, scope, user, access);
    const [[record]] = await c.query<RowDataPacket[]>(
      reportSelect + ` WHERE id=? AND project_id=? AND account_id=? ${access === 'personal' ? 'AND actor_id=?' : ''} FOR UPDATE`,
      [id, scope.projectId, scope.accountId, ...(access === 'personal' ? [user.sub] : [])],
    );
    if (!record) throw new AppError(404, 40401, '举报记录不存在');
    if (Number(record.attempt) !== attempt) return { record };
    const status = publicReport(record).status;
    if (!['failed', 'unknown'].includes(status)) return { record };
    if (status === 'unknown' && !checked) throw new AppError(409, 40901, '请先查询知乎举报结果，确认未收到后再重试');
    const input = reportSchema.parse(
      typeof record.payload_json === 'string' ? JSON.parse(record.payload_json) : record.payload_json,
    );
    const { payload } = await prepare(c, scope, input, String(record.actor_id), access);
    if(payload.composition_id!==record.upstream_composition_id)throw new AppError(409,40901,'关联作品已更新，请重新填写举报资料');
    await c.query("UPDATE zh_risk_reports SET status='sending',message='',attempt=attempt+1 WHERE id=?", [id]);
    await writeAudit(
      {
        userId: user.sub,
        action: 'zhihu.risk.retry',
        resourceType: 'zh_risk_report',
        resourceId: id,
        detail: { ...scope, checkedNotReceived: checked, attempt: attempt + 1 },
      },
      c,
    );
    return { record: { ...record, attempt: attempt + 1 } as RowDataPacket, payload };
  });
  return reserved.payload
    ? deliver(user, scope, id, Number(reserved.record.attempt), reserved.payload)
    : publicReport(reserved.record);
}
export async function personalRiskResult(user: AuthUser, scope: Scope, id: string, offset = 0) {
  await authorizeRisk(user, scope, 'personal');
  const [record] = await rows<RowDataPacket>(
    'SELECT keyword,risk_type FROM zh_risk_reports WHERE id=? AND project_id=? AND account_id=? AND actor_id=?',
    [id, scope.projectId, scope.accountId, user.sub],
  );
  if (!record) throw new AppError(404, 40401, '举报记录不存在');
  // The upstream response identifies a risk word, not an individual report.
  // Send only the saved word, and never return another word or channel details.
  return riskWordResult(String(record.keyword), 1, offset, Number(record.risk_type));
}
async function riskWordResult(keyword: string, type: 0 | 1, offset: number, riskType?: number) {
  const result = await riskList({ type, keyword, risk_type: riskType, offset, limit: 100 });
  return {
    list: result.list
      .filter((row) => row.keyword === keyword && (riskType === undefined || row.riskType === riskType))
      .map(({ keyword, riskType, status, validedAt }) => ({ keyword, riskType, status, validedAt })),
    hasNext: result.hasNext,
  };
}
export async function personalWorkRisk(user: AuthUser, scope: Scope, compositionId: string, offset: number) {
  await authorizeRisk(user, scope, 'personal');
  const [work] = await rows<RowDataPacket>(
    `SELECT p.keyword FROM compositions c JOIN plans p ON p.id=c.plan_id
    WHERE c.id=? AND c.owner_id=? AND p.project_id=? AND ${planAccountSql()}=? AND ${eligible}`,
    [compositionId, user.sub, scope.projectId, scope.accountId],
  );
  if (!work) throw new AppError(404, 40401, '原作品不存在或已不属于本人，请重新选择');
  return riskWordResult(String(work.keyword), 0, offset);
}
