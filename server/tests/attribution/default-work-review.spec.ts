import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthUser } from '../../src/types';
import { runOpcMigrations } from '../../scripts/opcMigrations';

vi.mock('../../src/modules/zhihu/queue', async (original) => ({
  ...(await original<typeof import('../../src/modules/zhihu/queue')>()),
  enqueue: vi.fn(async () => ({ id: 'isolated' })),
}));
const key = () => crypto.randomUUID();
const scope = { accountId: '', projectId: '1' };
const user = (sub: string, role: AuthUser['role'], adminDuty: AuthUser['adminDuty'] = 'all'): AuthUser => ({
  sub,
  role,
  adminDuty,
  parentId: null,
  displayName: '人员' + sub,
  username: 'default-review-' + sub,
  jti: key(),
});
const admin = user('1', 'admin');
const creator = user('2', 'creator');
const ops = user('3', 'admin', 'operations');
const finance = user('4', 'admin', 'finance');
const other = user('5', 'creator');
let container: StartedMySqlContainer, c: Connection, app: Express;
let pool: typeof import('../../src/db').db;
let resources: typeof import('../../src/modules/zhihu/attribution/resources');
let workbench: typeof import('../../src/modules/zhihu/attribution/workbench');
let reconciliation: typeof import('../../src/modules/zhihu/attribution/work-reconciliation');
let confirmation: typeof import('../../src/modules/zhihu/services/automatic-work-check');
let mappingId: string;
const headers: Record<string, Record<string, string>> = {};
const query = async (sql: string, args: unknown[] = []) => (await c.query<RowDataPacket[]>(sql, args))[0];
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withCommand(['--log-bin-trust-function-creators=1'])
    .withDatabase('default_work_review_test')
    .withUsername('test')
    .withUserPassword('isolated')
    .start();
  const target = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getUserPassword(),
  };
  Object.assign(process.env, {
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    OPC_MODULES: 'zhihu',
    DEV_DEMO_AUTH: '0',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  for (const actor of [admin, creator, ops, finance, other]) {
    await c.query('INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(?,?,?,?,?,?)', [
      actor.sub,
      actor.username,
      'unused',
      actor.role,
      actor.displayName,
      actor.adminDuty,
    ]);
  }
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,5)');
  scope.accountId = String((await query('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await c.query(
    "INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'review-channel',1,'默认审核渠道')",
  );
  await c.query(
    "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'review-task','默认审核活动',NOW())",
  );
  resources = await import('../../src/modules/zhihu/attribution/resources');
  workbench = await import('../../src/modules/zhihu/attribution/workbench');
  reconciliation = await import('../../src/modules/zhihu/attribution/work-reconciliation');
  confirmation = await import('../../src/modules/zhihu/services/automatic-work-check');
  pool = (await import('../../src/db')).db;
  mappingId = (
    await resources.createMapping(admin, scope, key(), { channelId: '1', name: '默认审核渠道', from: '2026-09-01' })
  ).id;
  const { ModuleRuntime } = await import('../../src/core/module-runtime');
  const { zhihuManifest } = await import('../../src/modules/zhihu/manifest');
  const { createZhihuModule } = await import('../../src/modules/zhihu/module');
  const { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register(createZhihuModule());
  app = createCoreApp(runtime);
  const { signToken } = await import('../../src/auth/jwt');
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  for (const actor of [admin, creator, ops, finance, other]) {
    const client = 'default-review-client-' + actor.sub;
    const session = await issueRefreshSession(actor.sub, { type: 'web', id: client });
    headers[actor.sub] = {
      'X-Client-Id': client,
      Authorization: 'Bearer ' + (await signToken({ ...actor, id: actor.sub, sessionId: session.familyId })),
    };
  }
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop();
});

let serial = 0;
async function word() {
  const keyword = '默认审核词' + ++serial;
  const saved = await resources.createKeyword(admin, scope, key(), {
    keyword,
    taskId: '1',
    mappingId,
    landingUrl: 'https://example.com/default-review',
    popularizeType: 1,
  });
  await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?", [
    'review-' + serial,
    saved.planId,
  ]);
  await resources.synchronizeKeywords(scope);
  const binding = await resources.distribute(admin, scope, saved.id, key(), creator.sub);
  await resources.changeBinding(creator, scope, binding.id, key(), { action: 'activate' });
  await c.query("UPDATE zh_keyword_bindings SET activated_on='2026-09-01' WHERE id=?", [binding.id]);
  return { ...saved, bindingId: binding.id, keyword };
}
type Word = Awaited<ReturnType<typeof word>>;
const submit = (item: Word, actor = creator, requestKey = key(), url = 'https://example.com/review/' + item.id) =>
  request(app)
    .post('/api/v1/modules/zhihu/evidence')
    .set(headers[actor.sub])
    .send({ ...scope, bindingId: item.bindingId, url, description: '实际发布作品', requestKey });
async function evidence(item: Word, status = 'pending', url = 'https://example.com/history/' + item.id) {
  const [row] = await c.query<ResultSetHeader>(
    'INSERT INTO zh_evidence(binding_id,work_url,description,submitted_by,status) VALUES(?,?,?,?,?)',
    [item.bindingId, url, '已有登记资料', creator.sub, status],
  );
  return String(row.insertId);
}
async function composition(
  item: Word,
  fields: { owner?: string; published?: string | null; sync?: string; raw?: unknown; url?: string } = {},
) {
  const [row] = await c.query<ResultSetHeader>(
    `INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,
    composition_sub_type,promo_url,release_time,sync_status,zhihu_composition_id,zhihu_status_json) VALUES(?,?,'KOC抖音','review',2,1,?,?,?,?,?)`,
    [
      item.planId,
      fields.owner ?? creator.sub,
      fields.url ?? 'https://example.com/composition/' + key(),
      fields.published === undefined ? '2026-09-02 12:00:00' : fields.published,
      fields.sync ?? 'synced',
      key().slice(0, 16),
      fields.raw ? JSON.stringify(fields.raw) : null,
    ],
  );
  return String(row.insertId);
}
const binding = async (item: Word) =>
  (await query('SELECT * FROM zh_keyword_bindings WHERE id=?', [item.bindingId]))[0];
const audit = (item: Word) =>
  query("SELECT * FROM audit_logs WHERE action='zhihu.work.default-review' AND resource_id=? ORDER BY id", [
    item.bindingId,
  ]);
async function upload(item: Word) {
  const buffer = Buffer.from(`日期,渠道,关键词,订单量\n2026-09-03,默认审核渠道,${item.keyword},1`);
  return workbench.uploadReport(finance, scope, {
    originalname: 'default.csv',
    mimetype: 'text/csv',
    buffer,
    size: buffer.length,
  });
}

it('登记无业绩作品即持久默认通过，后到报表直接可核算且本人不可人工核验', async () => {
  const item = await word();
  const response = await submit(item);
  expect(response.status, response.text).toBe(201);
  expect((await binding(item)).verification_status).toBe('passed');
  const [saved] = await query('SELECT * FROM zh_evidence WHERE id=?', [response.body.data.id]);
  expect(saved.status).toBe('passed');
  expect(saved.reviewed_by).toBeNull();
  expect(saved.reviewed_at).not.toBeNull();
  expect(await audit(item)).toHaveLength(1);
  const detail = (await audit(item))[0].detail_json;
  expect(typeof detail === 'string' ? JSON.parse(detail) : detail).toMatchObject({
    policy: 'R7-default-review-v1',
    trigger: 'evidence.submit',
  });
  for (const actor of [creator, other, finance]) {
    const denied = await request(app)
      .post('/api/v1/modules/zhihu/evidence/' + saved.id + '/review')
      .set(headers[actor.sub])
      .send({ ...scope, accept: true, reason: '旧客户端', requestKey: key() });
    expect(denied.status).toBe(403);
  }
  await upload(item);
  const view = await workbench.overview(finance, scope, { from: '2026-09-03', to: '2026-09-03' });
  expect(view.entries.find((entry) => entry.keywordId === item.id)).toMatchObject({ ready: true, amount: '8.0000' });
});

it('历史独立证据零业绩可预览和应用，预览只读且重复应用无额外转换', async () => {
  const item = await word();
  const evidenceId = await evidence(item);
  const before = await binding(item);
  const logsBefore = await query('SELECT id FROM audit_logs');
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  expect(preview.keywordIds).toContain(item.id);
  expect(await binding(item)).toEqual(before);
  expect(await query('SELECT id FROM audit_logs')).toEqual(logsBefore);
  await expect(reconciliation.reconcileRegisteredWorks(ops, scope, true)).rejects.toMatchObject({ httpStatus: 403 });
  await expect(
    reconciliation.reconcileRegisteredWorks(finance, { ...scope, projectId: '999' }, true),
  ).rejects.toMatchObject({ httpStatus: 403 });
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect((await binding(item)).verification_status).toBe('passed');
  expect((await query('SELECT status FROM zh_evidence WHERE id=?', [evidenceId]))[0].status).toBe('passed');
  const applied = await binding(item);
  const provenance = await audit(item);
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect(await binding(item)).toEqual(applied);
  expect(await audit(item)).toEqual(provenance);
});

it('上游待审核仅保留为原始来源，平台默认审核来源持久且并发回执只转换一次', async () => {
  const item = await word();
  const id = await composition(item, { raw: { auditStatus: 'pending', rawMarker: 'preserve-me' } });
  const upstream = await query('SELECT * FROM compositions WHERE id=?', [id]);
  await Promise.all([confirmation.confirmSubmittedWorks(id), confirmation.confirmSubmittedWorks(id)]);
  expect((await binding(item)).verification_status).toBe('passed');
  expect(await audit(item)).toHaveLength(1);
  expect(await query('SELECT * FROM compositions WHERE id=?', [id])).toEqual(upstream);
});

it.each([
  ['missing', 'WORK_MISSING'],
  ['failed', 'WORK_SUBMISSION_FAILED'],
  ['remote-rejected', 'WORK_REJECTED'],
  ['evidence-rejected', 'WORK_REJECTED'],
  ['disputed', 'WORK_DISPUTED'],
  ['conflicting-owner', 'WORK_OWNERSHIP_CONFLICT'],
  ['unknown-other-date', 'WORK_OWNERSHIP_CONFLICT'],
  ['before-start', 'WORK_PERIOD_MISSING'],
  ['missing-date', 'WORK_PERIOD_MISSING'],
  ['invalid-url', 'WORK_SOURCE_INVALID'],
  ['local-submission', 'WORK_SUBMISSION_PENDING'],
] as const)('独立异常保留且预览应用一致 %s', async (kind, reasonCode) => {
  const item = await word();
  const url = 'https://example.com/exception/' + item.id;
  if (kind === 'failed' || kind === 'local-submission') {
    await evidence(item, 'pending', url);
    await composition(item, { sync: kind === 'failed' ? 'failed' : 'local', url });
  }
  if (kind === 'remote-rejected')
    await composition(item, { raw: { auditStatus: 'rejected', rejectReason: '实际退回' } });
  if (kind === 'evidence-rejected') await evidence(item, 'rejected');
  if (kind === 'disputed') {
    await evidence(item);
    await c.query("UPDATE zh_keyword_bindings SET verification_status='disputed' WHERE id=?", [item.bindingId]);
  }
  if (kind === 'conflicting-owner' || kind === 'unknown-other-date') {
    await evidence(item);
    await composition(item, {
      owner: other.sub,
      published: kind === 'unknown-other-date' ? null : '2026-09-02 12:00:00',
    });
  }
  if (kind === 'before-start') await composition(item, { published: '2026-08-31 12:00:00' });
  if (kind === 'missing-date') {
    await evidence(item);
    await c.query('UPDATE zh_keyword_bindings SET activated_on=NULL WHERE id=?', [item.bindingId]);
  }
  if (kind === 'invalid-url') await evidence(item, 'pending', 'javascript:invalid');
  const before = await binding(item);
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  const expected = preview.items.find((row) => row.bindingId === item.bindingId);
  expect(expected).toMatchObject({ status: 'blocked', reasonCode, changed: false });
  const applied = await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect(applied.items.find((row) => row.bindingId === item.bindingId)).toEqual(expected);
  expect(await binding(item)).toEqual(before);
  expect(await audit(item)).toHaveLength(0);
});

it('已结束执行期按保存归属处理，不把原作品归给后来执行人', async () => {
  const original = await word();
  await evidence(original);
  await composition(original);
  await c.query(
    "UPDATE zh_keyword_bindings SET released_at='2026-09-10 00:00:00',release_status='approved' WHERE id=?",
    [original.bindingId],
  );
  const [next] = await c.query<ResultSetHeader>(
    `INSERT INTO zh_keyword_bindings(keyword_id,path_type,executor_id,relation_snapshot,
    activated_on,used_at) VALUES(?,'direct_creator',?,'{}','2026-09-11','2026-09-11 00:00:00')`,
    [original.id, other.sub],
  );
  await c.query('UPDATE zh_keywords SET current_binding_id=? WHERE id=?', [next.insertId, original.id]);
  const replacement = { ...original, bindingId: String(next.insertId) };
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  expect(preview.items.find((item) => item.bindingId === original.bindingId)?.status).toBe('ready');
  expect(preview.items.find((item) => item.bindingId === replacement.bindingId)?.reasonCode).toBe('WORK_MISSING');
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect((await binding(original)).verification_status).toBe('passed');
  expect((await binding(replacement)).verification_status).toBe('pending');
  expect((await audit(original))[0].resource_id).toBe(original.bindingId);
  const newWork = await composition(replacement, { owner: other.sub, published: '2026-09-12 12:00:00' });
  await confirmation.confirmSubmittedWorks(newWork);
  expect((await binding(replacement)).verification_status).toBe('passed');
  expect(await audit(original)).toHaveLength(1);
});

it('作品列表与详情返回独立平台审核状态，原始待审核字段和读取权限保留', async () => {
  const item = await word();
  const id = await composition(item, { raw: { auditStatus: 'pending' } });
  await confirmation.confirmSubmittedWorks(id);
  const read = (actor: AuthUser, suffix: string) =>
    request(app)
      .get('/api/v1/modules/zhihu/compositions' + suffix)
      .set(headers[actor.sub]);
  const own = await read(creator, '/' + id);
  expect(own.status, own.text).toBe(200);
  expect(own.body.data.platformVerificationStatus).toBe('passed');
  expect(own.body.data.status).toBe('pending');
  expect(own.body.data.zhihuStatusJson).toBe(JSON.stringify({ auditStatus: 'pending' }));
  expect((await read(other, '/' + id)).status).toBe(404);
  const list = await read(creator, '?planId=' + item.planId);
  expect(list.status, list.text).toBe(200);
  expect(list.body.data.list[0].platformVerificationStatus).toBe('passed');
  expect((await read(other, '?planId=' + item.planId)).body.data.list).toHaveLength(0);
  const { listWorks } = await import('../../src/modules/zhihu/attribution/works');
  expect((await listWorks(creator, scope, 1, 25, { planId: item.planId })).list[0]).toMatchObject({
    verification_status: 'passed',
    status: 'pending',
  });
  expect((await listWorks(other, scope, 1, 25, { planId: item.planId })).list).toHaveLength(0);
});

it('默认通过后实际问题仍可退回，越权退回被拒且重复通过不覆盖机器来源', async () => {
  const item = await word();
  const added = await submit(item);
  expect(added.status).toBe(201);
  const id = added.body.data.id;
  const review = (actor: AuthUser, accept: boolean) =>
    request(app)
      .post('/api/v1/modules/zhihu/evidence/' + id + '/review')
      .set(headers[actor.sub])
      .send({ ...scope, accept, reason: '链接对应作品需要补正', requestKey: key() });
  const before = await query('SELECT * FROM zh_evidence WHERE id=?', [id]);
  const current = await binding(item);
  const accepted = await Promise.all([review(ops, true), review(ops, true)]);
  expect(accepted.map((result) => result.status)).toEqual([200, 200]);
  expect(await query('SELECT * FROM zh_evidence WHERE id=?', [id])).toEqual(before);
  expect(await binding(item)).toEqual(current);
  for (const actor of [creator, other, finance]) expect((await review(actor, false)).status).toBe(403);
  expect((await review(ops, false)).status).toBe(200);
  expect((await binding(item)).verification_status).toBe('pending');
  expect((await query('SELECT status FROM zh_evidence WHERE id=?', [id]))[0].status).toBe('rejected');
  expect((await review(ops, true)).status).toBe(409);
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect((await binding(item)).verification_status).toBe('pending');
});

it('关联的报送失败不能被旧人工核验入口绕过，补齐回执后自动通过', async () => {
  const item = await word();
  const url = 'https://example.com/failure/' + item.id;
  const workId = await composition(item, { sync: 'failed', url });
  const added = await submit(item, creator, key(), url);
  expect(added.status, added.text).toBe(201);
  expect((await binding(item)).verification_status).toBe('pending');
  const blocked = await request(app)
    .post('/api/v1/modules/zhihu/evidence/' + added.body.data.id + '/review')
    .set(headers[ops.sub])
    .send({ ...scope, accept: true, reason: '旧客户端核验', requestKey: key() });
  expect(blocked.status).toBe(409);
  await c.query("UPDATE compositions SET sync_status='synced',sync_error=NULL WHERE id=?", [workId]);
  await confirmation.confirmSubmittedWorks(workId);
  expect((await binding(item)).verification_status).toBe('passed');
  expect((await query('SELECT status FROM zh_evidence WHERE id=?', [added.body.data.id]))[0].status).toBe('passed');
});

it.each(['pending', 'rejected', 'failed'] as const)('旧记录收录复用默认规则并保存独立异常 %s', async (state) => {
  const keyword = '旧记录规则' + ++serial;
  const [plan] = await c.query<ResultSetHeader>(
    `INSERT INTO plans(project_id,zhihu_plan_id,zhihu_task_id,channel_id,keyword,
    landing_url,popularize_type,owner_id,created_by,status,sync_status)
    VALUES(1,?,'review-task','review-channel',?,'https://example.com/old-review',1,2,1,'active','synced')`,
    ['old-review-' + serial, keyword],
  );
  const original = { id: '', bindingId: '', planId: String(plan.insertId), keyword };
  const workId = await composition(original, {
    raw: { auditStatus: state === 'rejected' ? 'rejected' : 'pending' },
    sync: state === 'failed' ? 'failed' : 'synced',
  });
  const rawBefore = await query('SELECT * FROM compositions WHERE id=?', [workId]);
  const { withTransaction } = await import('../../src/db');
  const { scopeLock } = await import('../../src/modules/zhihu/attribution/store');
  const { adoptLegacyReportRecord } = await import('../../src/modules/zhihu/attribution/legacy-report-records');
  const id = await withTransaction(async (connection) => {
    await scopeLock(connection, scope, ops);
    return adoptLegacyReportRecord(connection, ops, scope, mappingId, keyword, original.planId);
  });
  const [saved] = await query('SELECT b.* FROM zh_keyword_bindings b WHERE b.keyword_id=?', [id]);
  expect(saved.verification_status).toBe(state === 'pending' ? 'passed' : 'pending');
  expect(await query('SELECT * FROM compositions WHERE id=?', [workId])).toEqual(rawBefore);
  const provenance = await audit({ ...original, id, bindingId: String(saved.id) });
  expect(provenance).toHaveLength(state === 'pending' ? 1 : 0);
});

it.each(['failed', 'rejected'] as const)('R7-P1 后到明确异常撤下原默认通过并阻断未确认业绩 %s', async (state) => {
  const item = await word();
  const url = 'https://example.com/review/' + item.id;
  expect((await submit(item)).status).toBe(201);
  expect((await binding(item)).verification_status).toBe('passed');
  const workId = await composition(item, {
    url,
    sync: state === 'failed' ? 'failed' : 'synced',
    raw: { auditStatus: state === 'rejected' ? 'rejected' : 'pending' },
  });
  const before = await query('SELECT * FROM compositions WHERE id=?', [workId]);
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  expect(preview.items.find((row) => row.bindingId === item.bindingId)).toMatchObject({
    status: 'blocked',
    reasonCode: state === 'failed' ? 'WORK_SUBMISSION_FAILED' : 'WORK_REJECTED',
  });
  await confirmation.confirmSubmittedWorks(workId);
  expect((await binding(item)).verification_status).toBe('pending');
  await upload(item);
  const view = await workbench.overview(finance, scope, { from: '2026-09-03', to: '2026-09-03' });
  expect(view.entries.find((entry) => entry.keywordId === item.id)?.ready).toBe(false);
  expect(await query('SELECT * FROM compositions WHERE id=?', [workId])).toEqual(before);
  expect(await audit(item)).toHaveLength(1);
});

it('R7-P2 合格证据先处理并逐项保留关联报送等待，补齐后继续处理', async () => {
  const item = await word();
  const readyId = await evidence(item);
  const url = 'https://example.com/partial/' + item.id;
  const pendingId = await evidence(item, 'pending', url);
  const workId = await composition(item, { sync: 'local', url });
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  const row = preview.items.find((itemRow) => itemRow.bindingId === item.bindingId)!;
  expect(row).toMatchObject({ status: 'ready' });
  expect(row).toMatchObject({
    sources: expect.arrayContaining([
      expect.objectContaining({ kind: 'evidence', id: readyId, status: 'ready' }),
      expect.objectContaining({
        kind: 'evidence',
        id: pendingId,
        status: 'blocked',
        reasonCode: 'WORK_SUBMISSION_PENDING',
      }),
    ]),
  });
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect((await binding(item)).verification_status).toBe('passed');
  expect((await query('SELECT status FROM zh_evidence WHERE id=?', [pendingId]))[0].status).toBe('pending');
  await c.query("UPDATE compositions SET sync_status='synced' WHERE id=?", [workId]);
  await confirmation.confirmSubmittedWorks(workId);
  expect((await query('SELECT status FROM zh_evidence WHERE id=?', [pendingId]))[0].status).toBe('passed');
});

it('R7-P1 报送本地失败立即刷新原默认通过，最终确认也重查后到异常', async () => {
  const item = await word();
  const url = 'https://example.com/review/' + item.id;
  await submit(item);
  await upload(item);
  const view = await workbench.overview(finance, scope, { from: '2026-09-03', to: '2026-09-03' });
  expect(view.entries.find((entry) => entry.keywordId === item.id)?.ready).toBe(true);
  const workId = await composition(item, { url, sync: 'local', published: null });
  await expect(
    workbench.confirmBills(finance, scope, { from: '2026-09-03', to: '2026-09-03' }, key(), view.reviewHash),
  ).rejects.toMatchObject({ httpStatus: 409 });
  const { pushComposition } = await import('../../src/modules/zhihu/jobs/pushComposition');
  await pushComposition({ compositionId: workId });
  expect((await query('SELECT sync_status FROM compositions WHERE id=?', [workId]))[0].sync_status).toBe('failed');
  expect((await binding(item)).verification_status).toBe('pending');
  expect(
    (await workbench.overview(finance, scope, { from: '2026-09-03', to: '2026-09-03' })).entries.find(
      (entry) => entry.keywordId === item.id,
    )?.ready,
  ).toBe(false);
});

it('R7-P3 新执行人复用前执行人的作品地址仍按归属冲突处理', async () => {
  const original = await word();
  const url = 'https://example.com/previous-owner/' + original.id;
  await composition(original, { url });
  await c.query(
    "UPDATE zh_keyword_bindings SET released_at='2026-09-10 00:00:00',release_status='approved' WHERE id=?",
    [original.bindingId],
  );
  const [next] = await c.query<ResultSetHeader>(
    `INSERT INTO zh_keyword_bindings(keyword_id,path_type,executor_id,relation_snapshot,
    activated_on,used_at) VALUES(?,'direct_creator',?,'{}','2026-09-11','2026-09-11 00:00:00')`,
    [original.id, other.sub],
  );
  await c.query('UPDATE zh_keywords SET current_binding_id=? WHERE id=?', [next.insertId, original.id]);
  const replacement = { ...original, bindingId: String(next.insertId) };
  const evidenceId = await evidence(replacement, 'pending', url);
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  expect(preview.items.find((item) => item.bindingId === replacement.bindingId)).toMatchObject({
    status: 'blocked',
    reasonCode: 'WORK_OWNERSHIP_CONFLICT',
    sources: expect.arrayContaining([
      expect.objectContaining({ kind: 'evidence', id: evidenceId, reasonCode: 'WORK_OWNERSHIP_CONFLICT' }),
    ]),
  });
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect((await binding(original)).verification_status).toBe('passed');
  expect((await binding(replacement)).verification_status).toBe('pending');
});

it('R7-P4 清理操作审计后人工归属结论及默认规则来源仍然稳定', async () => {
  const item = await word();
  const workId = await composition(item, { published: '2026-08-31 12:00:00' });
  const accepted = await request(app)
    .post('/api/v1/modules/zhihu/keywords/' + item.id + '/review-existing-work')
    .set(headers[ops.sub])
    .send({ ...scope, bindingId: item.bindingId, compositionId: workId, requestKey: key() });
  expect(accepted.status, accepted.text).toBe(200);
  const defaultItem = await word();
  await submit(defaultItem);
  await c.query(
    "DELETE FROM audit_logs WHERE action IN ('zhihu.work.review-existing','zhihu.work.default-review','zhihu.work.review-blocked')",
  );
  const before = await binding(item);
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  expect(preview.items.find((row) => row.bindingId === item.bindingId)?.status).toBe('unchanged');
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect(await binding(item)).toEqual(before);
  const { listWorks } = await import('../../src/modules/zhihu/attribution/works');
  expect((await listWorks(creator, scope, 1, 25, { planId: item.planId })).list[0].verification_status).toBe('passed');
  expect(
    await query('SELECT * FROM zh_work_review_records WHERE binding_id=? AND policy=?', [
      defaultItem.bindingId,
      'R7-default-review-v1',
    ]),
  ).toHaveLength(1);
});

it('R7-P5 同一时间精度内后退回旧作品优先于先通过的新作品', async () => {
  const item = await word();
  const older = await submit(item);
  const newer = await submit(item, creator, key(), 'https://example.com/new-review/' + item.id);
  const newerId = newer.body.data.id;
  await c.query("UPDATE zh_evidence SET status='pending' WHERE id=?", [newerId]);
  const review = (id: string, accept: boolean) =>
    request(app)
      .post('/api/v1/modules/zhihu/evidence/' + id + '/review')
      .set(headers[ops.sub])
      .send({ ...scope, accept, reason: '核实作品', requestKey: key() });
  expect((await review(newerId, true)).status).toBe(200);
  // Freeze identical displayed timestamps while preserving real transaction order.
  expect((await review(older.body.data.id, false)).status).toBe(200);
  await c.query("UPDATE zh_evidence SET reviewed_at='2026-11-04 12:00:00.000' WHERE binding_id=?", [item.bindingId]);
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  expect(preview.items.find((row) => row.bindingId === item.bindingId)).toMatchObject({
    status: 'blocked',
    reasonCode: 'WORK_REJECTED',
  });
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect((await binding(item)).verification_status).toBe('pending');
  const corrected = await submit(item, creator, key(), 'https://example.com/corrected-review/' + item.id);
  expect((await review(corrected.body.data.id, true)).status).toBe(200);
  await c.query("UPDATE zh_evidence SET reviewed_at='2026-11-04 12:00:00.000' WHERE binding_id=?", [item.bindingId]);
  await reconciliation.reconcileRegisteredWorks(finance, scope, true);
  expect((await binding(item)).verification_status).toBe('passed');
});

it('R7-P4 业务审核迁移可重复执行并保留历史已通过及确认账', async () => {
  const legacy = await word();
  await composition(legacy, { published: '2026-08-31 12:00:00' });
  await c.query("UPDATE zh_keyword_bindings SET verification_status='passed' WHERE id=?", [legacy.bindingId]);
  const oldManual = await word();
  const oldWork = await composition(oldManual, { published: '2026-08-31 12:00:00' });
  const reviewed = await request(app)
    .post('/api/v1/modules/zhihu/keywords/' + oldManual.id + '/review-existing-work')
    .set(headers[ops.sub])
    .send({ ...scope, bindingId: oldManual.bindingId, compositionId: oldWork, requestKey: key() });
  expect(reviewed.status).toBe(200);
  const oldDefault = await word();
  await submit(oldDefault);
  await c.query('DELETE FROM zh_work_review_records WHERE binding_id IN (?,?)', [
    oldManual.bindingId,
    oldDefault.bindingId,
  ]);
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('schema/zhihu/041_work_review_records.sql', 'utf8');
  const apply = async () => {
    for (const statement of sql.split(';').filter((text) => text.trim())) await c.query(statement);
  };
  const cashBefore = await query('SELECT * FROM opc_income_entries ORDER BY id');
  await apply();
  const records = await query('SELECT * FROM zh_work_review_records ORDER BY id');
  expect(
    records.some((record) => String(record.binding_id) === legacy.bindingId && record.policy === 'legacy-approved-v1'),
  ).toBe(true);
  await apply();
  expect(await query('SELECT * FROM zh_work_review_records ORDER BY id')).toEqual(records);
  await c.query("DELETE FROM audit_logs WHERE action LIKE 'zhihu.work.%'");
  const preview = await reconciliation.reconcileRegisteredWorks(finance, scope);
  expect(preview.items.find((item) => item.bindingId === legacy.bindingId)?.status).toBe('unchanged');
  expect(await query('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(cashBefore);
});
