import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../../db';
import { AppError } from '../../../middleware/errors';
import type { AuthUser } from '../../../types';
import { scopeFilter } from '../../../utils/scopeFilter';
import { writeAudit } from '../../../services/audit.service';
import { enqueue } from '../queue';
import { isDevDemoAuthUser } from '../dev-demo';
import { isCompositionCategoryValid } from '../zhihu/composition';
import { insertComposition, type CompositionInput } from './compositions.service';
import { balancedVideoCategories, compositionUrlKey, extractCompositionUrl, failImport, importFields, mediaFromUrl, parseCategory, parseCompositionFile, parseMedia, parseReleaseTime, type ImportOptions } from './composition-import-parser';

interface PlanRow extends RowDataPacket { id: string; keyword: string; status: string }
interface ExistingRow extends RowDataPacket { id: string; promo_url: string }
export interface WorkImportRow {
  row: number;
  status: 'ready' | 'duplicate' | 'invalid' | 'created';
  keyword: string;
  mediaAccount: string;
  mediaType: string;
  promoUrl: string;
  releaseTime: string;
  title: string;
  category?: string;
  errors: string[];
  notes: string[];
  id?: string;
  input?: CompositionInput;
}
const valueText = (value: unknown) => value == null ? '' : String(value).trim();

async function analyze(user: AuthUser, file: { originalname: string; buffer: Buffer }, options: ImportOptions, connection: PoolConnection) {
  if (isDevDemoAuthUser(user)) throw new AppError(409, 40900, '演示账号不支持真实导入，请使用正式账号登录');
  const parsed = parseCompositionFile(file, options);
  const scope = scopeFilter(user, 'owner_id');
  const [plans] = await connection.query<PlanRow[]>(`SELECT id, keyword, status FROM plans WHERE ${scope.clause}`, scope.bindings);
  // Only equality matches are exposed: no account, plan or private metadata from other owners.
  const [existing] = await connection.query<ExistingRow[]>('SELECT id, promo_url FROM compositions');
  const existingKeys = new Set(existing.map(item => compositionUrlKey(item.promo_url)).filter(Boolean));
  const externalKeys = new Set((options.knownExternal?.links || []).map(compositionUrlKey).filter(Boolean));
  const seen = new Map<string, number>();
  const categories = balancedVideoCategories(parsed.parsedRows.map(row => compositionUrlKey(valueText(row.values.promoUrl))).filter(key => key && !existingKeys.has(key) && !externalKeys.has(key)));
  const resultRows: WorkImportRow[] = parsed.parsedRows.map(({ row, values }) => {
    const promoUrl = extractCompositionUrl(valueText(values.promoUrl));
    const key = compositionUrlKey(promoUrl);
    const result: WorkImportRow = { row, status: 'ready', keyword: valueText(values.keyword), mediaAccount: valueText(values.mediaAccount), mediaType: valueText(values.mediaType), promoUrl, releaseTime: valueText(values.releaseTime), title: valueText(values.title), errors: [], notes: [] };
    if (promoUrl !== valueText(values.promoUrl)) result.notes.push('已从分享文本中提取作品链接');
    if (key && externalKeys.has(key)) {
      result.status = 'duplicate';
      result.notes.push(`线上核对快照已包含此链接（${options.knownExternal!.checkedAt}），跳过；推送前需复核`);
      return result;
    }
    if (key && existingKeys.has(key)) {
      result.status = 'duplicate';
      result.notes.push('该作品链接已登记，跳过，不修改已有作品');
      return result;
    }
    if (key && seen.has(key)) {
      result.status = 'duplicate';
      result.notes.push(`与本表第 ${seen.get(key)} 行作品链接重复，跳过`);
      return result;
    }
    if (!key || promoUrl.length > 1024) result.errors.push('推广链接必须是有效的 http/https 地址，且不超过 1024 字符');
    let plan: PlanRow | undefined;
    const explicitId = valueText(values.planId);
    if (explicitId) {
      plan = plans.find(p => String(p.id) === explicitId);
      if (!plan) result.errors.push('计划编号不存在或无权使用');
      else if (result.keyword && result.keyword !== plan.keyword) result.errors.push('计划编号与关键词不一致');
    } else if (result.keyword) {
      const matches = plans.filter(p => p.keyword === result.keyword && p.status !== 'ended');
      if (matches.length !== 1) result.errors.push(matches.length ? '关键词对应多个计划，请在表格中填写计划编号' : '未找到该关键词对应的可用计划');
      else plan = matches[0];
    } else if (options.defaults.planId) {
      plan = plans.find(p => String(p.id) === options.defaults.planId);
      if (!plan) result.errors.push('默认计划不存在或无权使用');
      else result.notes.push('使用所选默认计划');
    } else result.errors.push('缺少关键词或计划编号');
    if (plan?.status === 'ended') result.errors.push('该推广计划已结束');
    if (!result.mediaAccount || result.mediaAccount.length > 128) result.errors.push('媒体账号不能为空且不能超过 128 字符');
    if (typeof values.mediaAccount === 'number' && (!Number.isSafeInteger(values.mediaAccount) || values.mediaAccount < 0)) result.errors.push('账号数字精度无效，请在 Excel 中以文本保存账号');
    const linkMedia = mediaFromUrl(promoUrl);
    const mediaType = parseMedia(values.mediaType) || (!valueText(values.mediaType) ? linkMedia : undefined);
    if (!mediaType) result.errors.push('媒体类型未识别，请填写抖音、快手、小红书、视频号等平台');
    else {
      result.mediaType = mediaType;
      if (!valueText(values.mediaType)) result.notes.push('媒体类型根据链接域名识别');
      if (linkMedia && linkMedia !== mediaType) result.errors.push(`平台与链接不一致：链接属于${linkMedia.replace('KOC', '')}`);
    }
    const releaseTime = parseReleaseTime(valueText(values.releaseTime) ? values.releaseTime : options.defaults.releaseTime, parsed.date1904);
    if (!releaseTime) result.errors.push('发布时间缺失或无效，请填写完整日期');
    else {
      result.releaseTime = releaseTime;
      if (!valueText(values.releaseTime)) result.notes.push('使用所填默认发布时间');
      else if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?$/.test(valueText(values.releaseTime)) || (typeof values.releaseTime === 'number' && Number.isInteger(values.releaseTime))) result.notes.push('原表仅有日期，按北京时间 00:00 登记');
    }
    const rotate = options.categoryMode === 'rotate-video' && !valueText(values.compositionType) && !valueText(values.compositionSubType);
    const type = rotate ? 2 : valueText(values.compositionType) ? parseCategory(values.compositionType) : options.defaults.compositionType;
    const subType = rotate ? categories.get(key) : valueText(values.compositionSubType) ? parseCategory(values.compositionSubType, true) : options.defaults.compositionSubType;
    if (rotate) result.notes.push('视频子分类按所选设置均衡随机补填，未分析视频内容');
    result.category = `${type ?? '待补充'} / ${subType ?? '待补充'}`;
    if (type == null || subType == null || !isCompositionCategoryValid(type, subType)) result.errors.push('缺少或错误的作品分类，请选择默认分类或对应表格列');
    if (result.title.length > 255) result.errors.push('标题不能超过 255 字符');
    if (result.errors.length) result.status = 'invalid';
    else {
      result.keyword = plan!.keyword;
      result.input = { planId: String(plan!.id), mediaType: mediaType!, mediaAccount: result.mediaAccount, compositionType: type!, compositionSubType: subType!, title: result.title || null, promoUrl, releaseTime: releaseTime! };
      // A malformed earlier row must not suppress a later complete registration of the same link.
      seen.set(key, row);
    }
    return result;
  });
  const { parsedRows: _, date1904: __, ...metadata } = parsed;
  return { ...metadata, fields: importFields.map(({ key, label }) => ({ key, label })), total: resultRows.length, ready: resultRows.filter(row => row.status === 'ready').length, duplicate: resultRows.filter(row => row.status === 'duplicate').length, invalid: resultRows.filter(row => row.status === 'invalid').length, rows: resultRows };
}

export async function analyzeCompositionImport(user: AuthUser, file: { originalname: string; buffer: Buffer }, options: ImportOptions) {
  const connection = await db.getConnection();
  try { return await analyze(user, file, options, connection); }
  finally { connection.release(); }
}

export async function commitCompositionImport(user: AuthUser, file: { originalname: string; buffer: Buffer }, options: ImportOptions, ip?: string) {
  const connection = await db.getConnection();
  let locked = false;
  let preview: Awaited<ReturnType<typeof analyze>>;
  const ids: string[] = [];
  try {
    // Serialize imports, including repeat clicks and concurrent imports by different accounts.
    const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT('work-import:', LEFT(SHA2(DATABASE(),256),32)), 10) acquired");
    if (Number(lock[0]?.acquired) !== 1) throw new AppError(409, 40900, '另一批作品正在上传，请稍后重试');
    locked = true;
    await connection.beginTransaction();
    preview = await analyze(user, file, options, connection);
    if (!preview.total) failImport('当前工作表没有作品数据');
    for (const row of preview.rows) {
      if (row.status !== 'ready' || !row.input) continue;
      const id = await insertComposition(user, row.input, connection);
      ids.push(id);
      row.status = 'created';
      row.id = id;
    }
    await writeAudit({ userId: user.sub, action: 'composition.batch_create', resourceType: 'composition', detail: { source: 'spreadsheet', sheet: preview.sheetName, count: ids.length, duplicate: preview.duplicate, invalid: preview.invalid, ids }, ip }, connection);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally {
    try { if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT('work-import:', LEFT(SHA2(DATABASE(),256),32)))"); }
    finally { connection.release(); }
  }
  let queued = 0;
  const queueFailed: string[] = [];
  for (const id of ids) {
    try { await enqueue('push-composition', { compositionId: id }, { jobId: `composition-${id}`, removeOnComplete: true, removeOnFail: true }); queued++; }
    catch { queueFailed.push(id); }
  }
  return { ...preview!, ready: 0, created: ids.length, ids, queued, queueFailed, rows: preview!.rows.map(({ input: _, ...row }) => row) };
}
