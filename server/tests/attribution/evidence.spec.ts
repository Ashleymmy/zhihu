import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection } from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthUser } from '../../src/types';
import type { EvidenceResult, EvidenceRow } from '../../src/core/contracts';
import { runOpcMigrations } from '../../scripts/opcMigrations';

// Only isolate outgoing work submission. Parsing, SQL, source selection,
// withdrawal, authentication, and the Zhihu evidence provider remain real.
vi.mock('../../src/modules/zhihu/queue', async (original) => ({
  ...(await original<typeof import('../../src/modules/zhihu/queue')>()),
  enqueue: vi.fn(async () => ({ id: 'isolated-evidence-work' })),
}));

let container: StartedMySqlContainer;
let connection: Connection;
let pool: typeof import('../../src/db').db;
let app: Express;
let resources: typeof import('../../src/modules/zhihu/attribution/resources');
let workbench: typeof import('../../src/modules/zhihu/attribution/workbench');
const scope = { projectId: '1', accountId: '' };
const nonce = () => crypto.randomUUID();
const user = (sub: string, role: AuthUser['role'], adminDuty: AuthUser['adminDuty'] = 'all'): AuthUser => ({
  sub,
  role,
  adminDuty,
  parentId: null,
  displayName: `核验人员${sub}`,
  username: `evidence${sub}`,
  jti: nonce(),
});
const admin = user('1', 'admin');
const creator = user('2', 'creator');
const operations = user('3', 'admin', 'operations');
const finance = user('4', 'admin', 'finance');
const leader = user('5', 'leader');
const newlyPromoted = user('6', 'creator');
const actors = [admin, creator, operations, finance, leader, newlyPromoted];
const headers: Record<string, Record<string, string>> = {};
const previousActivation = process.env.ZHIHU_ACTIVATION_ENABLED;
const sql = async (statement: string, parameters: unknown[] = []) =>
  (await connection.query<mysql.RowDataPacket[]>(statement, parameters))[0];
let mappingId = '';
let otherMappingId = '';
let serial = 0;
type Word = { id: string; name: string; mappingId: string; channel: string; bindingId: string };
type Metric = 'new_user' | 'activation';

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('evidence_provider_test')
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
    ZHIHU_ACTIVATION_ENABLED: 'true',
  });
  await runOpcMigrations(target, ['zhihu']);
  connection = await mysql.createConnection(target);
  for (const actor of actors) {
    await connection.query(
      'INSERT INTO users(id,username,password_hash,role,display_name,admin_duty) VALUES(?,?,?,?,?,?)',
      [actor.sub, actor.username, 'unused', actor.role, actor.displayName, actor.adminDuty],
    );
  }
  // These are explicit known historical fixtures, not inferences from the
  // current project_members row or today's parent_id/role.
  for (const actor of [creator, leader]) {
    await connection.query("INSERT INTO project_members(project_id,user_id,joined_at) VALUES(1,?,'2026-07-01')", [
      actor.sub,
    ]);
    await connection.query(
      `INSERT INTO project_membership_history(user_id,project_id,member_role,effective_from,source_kind,source_ref)
       VALUES(?,1,?,'2026-07-01','registration',?)`,
      [actor.sub, actor.role, `registered-${actor.sub}`],
    );
    await connection.query(
      "INSERT INTO team_memberships(user_id,leader_id,source,effective_from) VALUES(?,NULL,'registration','2026-07-01')",
      [actor.sub],
    );
    await connection.query(
      "INSERT INTO member_role_history(user_id,to_role,reason,effective_at) VALUES(?,?,'registration','2026-07-01')",
      [actor.sub, actor.role],
    );
  }
  // This member has current access but no proven past participation. The
  // staff-path regression must not turn today's role into historical proof.
  await connection.query('INSERT INTO project_members(project_id,user_id) VALUES(1,?)', [newlyPromoted.sub]);
  scope.accountId = String((await sql('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await connection.query(
    `INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name)
     VALUES(1,1,'evidence-channel',1,'核验渠道'),(2,1,'evidence-channel-other',1,'另一核验渠道')`,
  );
  await connection.query(
    "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'evidence-task','核验推广活动',NOW())",
  );
  resources = await import('../../src/modules/zhihu/attribution/resources');
  workbench = await import('../../src/modules/zhihu/attribution/workbench');
  pool = (await import('../../src/db')).db;
  mappingId = (
    await resources.createMapping(admin, scope, nonce(), { channelId: '1', name: '核验渠道', from: '2026-07-01' })
  ).id;
  otherMappingId = (
    await resources.createMapping(admin, scope, nonce(), { channelId: '2', name: '另一核验渠道', from: '2026-07-01' })
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
  for (const actor of actors) {
    const client = `evidence-client-${actor.sub}`;
    const session = await issueRefreshSession(actor.sub, { type: 'web', id: client });
    headers[actor.sub] = {
      'X-Client-Id': client,
      Authorization: `Bearer ${await signToken({ ...actor, id: actor.sub, sessionId: session.familyId })}`,
    };
  }
}, 90000);

afterAll(async () => {
  if (previousActivation === undefined) delete process.env.ZHIHU_ACTIVATION_ENABLED;
  else process.env.ZHIHU_ACTIVATION_ENABLED = previousActivation;
  if (pool) await pool.end();
  if (connection) await connection.end();
  if (container) await container.stop();
});

async function word(label: string, otherChannel = false, executor = creator): Promise<Word> {
  const name = `${label}${++serial}`;
  const channel = otherChannel ? '另一核验渠道' : '核验渠道';
  const selectedMapping = otherChannel ? otherMappingId : mappingId;
  const created = await resources.createKeyword(admin, scope, nonce(), {
    keyword: name,
    taskId: '1',
    mappingId: selectedMapping,
    landingUrl: `https://example.com/evidence/${serial}`,
    popularizeType: 1,
  });
  await connection.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?", [
    `evidence-plan-${created.id}`,
    created.planId,
  ]);
  await resources.synchronizeKeywords(scope);
  const binding = await resources.distribute(admin, scope, created.id, nonce(), executor.sub);
  await resources.changeBinding(executor, scope, binding.id, nonce(), { action: 'activate' });
  // Seed the preserved original execution event with an explicit known time.
  await connection.query(
    "UPDATE zh_keyword_bindings SET activated_on='2026-07-01',claimed_at='2026-07-01',assigned_at='2026-07-01',used_at='2026-07-01' WHERE id=?",
    [binding.id],
  );
  const submitted = await request(app)
    .post('/api/v1/modules/zhihu/evidence')
    .set(headers[executor.sub])
    .send({
      ...scope,
      bindingId: binding.id,
      requestKey: nonce(),
      url: `https://example.com/evidence-work/${serial}`,
      description: '真实来源核验用历史作品',
    });
  expect(submitted.status, submitted.text).toBe(201);
  return { id: created.id, name, mappingId: selectedMapping, channel, bindingId: binding.id };
}

async function upload(csv: string, metricType: Metric = 'new_user'): Promise<string> {
  const result = await request(app)
    .post('/api/v1/modules/zhihu/workbench/import')
    .set(headers[finance.sub])
    .field('projectId', scope.projectId)
    .field('accountId', scope.accountId)
    .field('reportType', metricType)
    .attach('file', Buffer.from(csv), { filename: '官方核验.csv', contentType: 'text/csv' });
  expect(result.status, result.text).toBe(202);
  return result.body.data.id;
}

const orders = (entry: Word, date: string, quantity = '3', suffix = '') =>
  upload(`日期,渠道,关键词,订单量,收益\n${date},${entry.channel},${entry.name},${quantity},987654.3210${suffix}`);
const query = (parameters: Record<string, string | number>, actor = finance) =>
  request(app)
    .get('/api/v1/core/evidence')
    .set(headers[actor.sub])
    .query({ moduleId: 'zhihu', ...scope, ...parameters });
async function evidence(parameters: Record<string, string | number>, actor = finance): Promise<EvidenceResult> {
  const response = await query(parameters, actor);
  expect(response.status, response.text).toBe(200);
  return response.body.data;
}
async function one(entry: Word, date: string, metricType: Metric = 'new_user', actor = finance): Promise<EvidenceRow> {
  const result = await evidence(
    { from: date, to: date, channelRef: entry.mappingId, taskRef: entry.id, metricType },
    actor,
  );
  expect(result.total).toBe(1);
  expect(result.list).toHaveLength(1);
  expect(result.list[0].key).toEqual({
    ...scope,
    channelRef: entry.mappingId,
    taskRef: entry.id,
    businessDate: date,
    metricType,
  });
  return result.list[0];
}
const importEndpoint = (id: string) => `/api/v1/modules/zhihu/imports/${id}`;
const importAction = (id: string, action: string, body: Record<string, unknown>) =>
  request(app)
    .post(`${importEndpoint(id)}/${action}`)
    .set(headers[finance.sub])
    .send({ ...scope, requestKey: nonce(), ...body });
async function withdraw(id: string) {
  const preview = await request(app)
    .get(`${importEndpoint(id)}/withdrawal`)
    .set(headers[finance.sub])
    .query(scope);
  expect(preview.status, preview.text).toBe(200);
  const applied = await importAction(id, 'withdrawal', { reviewHash: preview.body.data.reviewHash });
  expect(applied.status, applied.text).toBe(200);
  return applied.body.data;
}
async function acceptNewSource(id: string) {
  const analysis = await request(app)
    .get(`${importEndpoint(id)}/analysis`)
    .set(headers[finance.sub])
    .query(scope);
  expect(analysis.status, analysis.text).toBe(200);
  const asks = analysis.body.data.steps.flatMap(
    (step: { asks?: { id: string; options: { key: string }[] }[] }) => step.asks ?? [],
  );
  const ask = asks.find((item: { options: { key: string }[] }) => item.options.some((option) => option.key === 'new'));
  expect(ask, analysis.text).toBeTruthy();
  const result = await importAction(id, 'answers', { askId: ask.id, option: 'new' });
  expect(result.status, result.text).toBe(200);
}

it('同日同词的有效零订单与拉活数量各有来源，零值不等于缺失', async () => {
  const entry = await word('零订单');
  const orderId = await orders(entry, '2026-08-01', '0');
  const activationId = await upload(
    `日期,渠道,关键词,拉活量,结算金额\n2026-08-01,${entry.channel},${entry.name},5,10`,
    'activation',
  );
  const zero = await one(entry, '2026-08-01');
  const activation = await one(entry, '2026-08-01', 'activation');
  expect(zero.official).toMatchObject({
    status: 'valid_zero',
    quantity: '0',
    coverageBasis: 'observed_rows',
    coverageIsExhaustive: false,
  });
  expect(activation.official).toMatchObject({ status: 'ready', quantity: '5', coverageIsExhaustive: false });
  expect(zero.official.sourceRefs).toEqual(expect.arrayContaining([expect.objectContaining({ batchId: orderId })]));
  expect(activation.official.sourceRefs).toEqual(
    expect.arrayContaining([expect.objectContaining({ batchId: activationId })]),
  );
  expect(zero.official.sourceRefs.every((source) => source.batchId !== activationId)).toBe(true);
  expect(activation.official.sourceRefs.every((source) => source.batchId !== orderId)).toBe(true);
  expect(zero.official.currentRevision).not.toBe(activation.official.currentRevision);
});

it('已知任务尚未收到必要官方资料时返回未到，数量保留空缺', async () => {
  const entry = await word('还没有报表');
  const row = await one(entry, '2026-08-02');
  expect(row.official).toMatchObject({
    status: 'not_arrived',
    quantity: null,
    coverageBasis: 'none',
    coverageIsExhaustive: false,
  });
  expect(row.result.status).not.toBe('ready');
  expect(row.result).toMatchObject({
    responsibleRole: 'finance',
    nextAction: expect.objectContaining({ requiredDuty: 'finance' }),
  });
});

it('稀疏日期只证明实际行，文件两端日期不能证明中间日完整', async () => {
  const entry = await word('稀疏日期');
  await upload(
    `日期,渠道,关键词,订单量\n2026-08-03,${entry.channel},${entry.name},2\n2026-08-05,${entry.channel},${entry.name},4`,
  );
  const result = await evidence({ from: '2026-08-03', to: '2026-08-05', taskRef: entry.id, metricType: 'new_user' });
  expect(result.total).toBe(3);
  const middle = result.list.find((row) => row.key.businessDate === '2026-08-04');
  expect(middle?.official).toMatchObject({ status: 'not_arrived', quantity: null, coverageIsExhaustive: false });
  expect(
    result.list
      .filter((row) => row.official.status === 'ready')
      .map((row) => row.official.quantity)
      .sort(),
  ).toEqual(['2', '4']);
});

it('同日同渠道已有其他词的订单行，目标词仍返回记录缺失', async () => {
  const target = await word('目标缺行');
  const reported = await word('已有同行');
  await orders(reported, '2026-08-06', '6');
  const row = await one(target, '2026-08-06');
  expect(row.official).toMatchObject({
    status: 'record_missing',
    quantity: null,
    coverageBasis: 'observed_rows',
    coverageIsExhaustive: false,
  });
  expect(row.result.status).not.toBe('ready');
});

it('搜索文件不冒充订单覆盖，另一类型的拉活也不填补缺失订单', async () => {
  const entry = await word('只有搜索');
  await upload(`日期,渠道,关键词,搜索量\n2026-08-07,${entry.channel},${entry.name},15`);
  await upload(`日期,渠道,关键词,拉活量\n2026-08-07,${entry.channel},${entry.name},2`, 'activation');
  const row = await one(entry, '2026-08-07');
  expect(row.official.quantity).toBeNull();
  expect(row.official.status).toBe('not_arrived');
  expect(row.result.status).not.toBe('ready');
  expect((await one(entry, '2026-08-07', 'activation')).official).toMatchObject({ status: 'ready', quantity: '2' });
});

it('预览文件尚未正式收录时呈现处理中，不当作已采用的业绩', async () => {
  const entry = await word('待收录资料');
  const preview = await request(app)
    .post('/api/v1/modules/zhihu/imports')
    .set(headers[finance.sub])
    .field('projectId', scope.projectId)
    .field('accountId', scope.accountId)
    .field('reportKind', 'order')
    .attach('file', Buffer.from(`日期,渠道,关键词,订单量\n2026-08-08,${entry.channel},${entry.name},9`), {
      filename: '待核对.csv',
      contentType: 'text/csv',
    });
  expect(preview.status, preview.text).toBe(201);
  const row = await one(entry, '2026-08-08');
  expect(row.official).toMatchObject({ status: 'processing', quantity: null });
  expect(row.result.status).toBe('processing');
});

it('冲突保留当前采用量及候选，财务选择后结果与版本自动变化', async () => {
  const entry = await word('更正冲突');
  const older = await orders(entry, '2026-08-09', '3');
  const before = await one(entry, '2026-08-09');
  const newer = await orders(entry, '2026-08-09', '7');
  const pending = await one(entry, '2026-08-09');
  expect(pending.official).toMatchObject({
    status: 'conflict',
    quantity: '3',
    currentRevision: before.official.currentRevision,
  });
  expect(pending.official.pendingConflict).toHaveLength(1);
  const [candidateRow] = await sql('SELECT CAST(id AS CHAR) id FROM zh_import_rows WHERE batch_id=?', [newer]);
  // batchId is optional in EvidenceSourceRef. The immutable row identifier
  // must still point to the actual uploaded candidate, never another file.
  expect(pending.official.pendingConflict[0].sourceRefs).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'official_row', id: candidateRow.id })]),
  );
  expect(pending.official.sourceRefs).toEqual(expect.arrayContaining([expect.objectContaining({ batchId: older })]));
  expect(pending.result.status).not.toBe('ready');
  await acceptNewSource(newer);
  const accepted = await one(entry, '2026-08-09');
  expect(accepted.official).toMatchObject({ status: 'ready', quantity: '7', pendingConflict: [] });
  expect(accepted.result.evidenceVersion).not.toBe(before.result.evidenceVersion);
  expect(accepted.official.currentRevision).not.toBe(before.official.currentRevision);
});

it('隐藏上传记录只改变列表展示，核验及有效来源保留', async () => {
  const entry = await word('隐藏来源');
  const id = await orders(entry, '2026-08-10', '4');
  const before = await one(entry, '2026-08-10');
  const hidden = await importAction(id, 'archive', { archived: true });
  expect(hidden.status, hidden.text).toBe(200);
  const after = await one(entry, '2026-08-10');
  expect(after.official).toEqual(before.official);
  expect(after.finance).toEqual(before.finance);
  expect(after.official.status).toBe('ready');
});

it('撤回一个重复文件保留替代，撤回全部后缺失，重传后恢复且不重复计数', async () => {
  const entry = await word('重复来源');
  const original = await orders(entry, '2026-08-11', '3');
  const alternative = await orders(entry, '2026-08-11', '3', '\n');
  expect(alternative).not.toBe(original);
  const initial = await one(entry, '2026-08-11');
  expect(initial.official.quantity).toBe('3');
  const originalRows = (await sql('SELECT CAST(id AS CHAR) id FROM zh_import_rows WHERE batch_id=?', [original])).map(
    (row) => row.id,
  );
  await withdraw(original);
  const retained = await one(entry, '2026-08-11');
  expect(retained.official).toMatchObject({ status: 'ready', quantity: '3' });
  expect(retained.official.sourceRefs).toEqual(
    expect.arrayContaining([expect.objectContaining({ batchId: alternative })]),
  );
  expect(
    retained.official.sourceRefs.some((source) => source.kind === 'official_row' && originalRows.includes(source.id)),
  ).toBe(false);
  expect(retained.official.withdrawnSourceRefs).toEqual(
    expect.arrayContaining(
      originalRows.map((id) => expect.objectContaining({ id, batchId: original, status: 'withdrawn' })),
    ),
  );
  expect(retained.official.sourceRefs.every((source) => source.status !== 'withdrawn')).toBe(true);
  expect(retained.finance?.amount).toBe(initial.finance?.amount);
  await withdraw(alternative);
  const removed = await one(entry, '2026-08-11');
  expect(removed.official).toMatchObject({ status: 'withdrawn', quantity: null });
  expect(removed.official.sourceRefs).toEqual([]);
  expect(removed.official.withdrawnSourceRefs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ batchId: original, status: 'withdrawn' }),
      expect.objectContaining({ batchId: alternative, status: 'withdrawn' }),
    ]),
  );
  expect(removed.result.status).not.toBe('ready');
  const restoredId = await orders(entry, '2026-08-11', '3');
  expect(restoredId).not.toBe(original);
  const restored = await one(entry, '2026-08-11');
  expect(restored.official).toMatchObject({ status: 'ready', quantity: '3' });
  expect(restored.finance?.amount).toBe(initial.finance?.amount);
});

it('撤回已采用更正后恢复原有效数字，不能保留撤回的新值', async () => {
  const entry = await word('撤回更正');
  const older = await orders(entry, '2026-08-12', '2');
  const newer = await orders(entry, '2026-08-12', '8');
  const newerRows = (await sql('SELECT CAST(id AS CHAR) id FROM zh_import_rows WHERE batch_id=?', [newer])).map(
    (row) => row.id,
  );
  await acceptNewSource(newer);
  expect((await one(entry, '2026-08-12')).official.quantity).toBe('8');
  await withdraw(newer);
  const row = await one(entry, '2026-08-12');
  expect(row.official).toMatchObject({ status: 'ready', quantity: '2' });
  expect(row.official.sourceRefs).toEqual(expect.arrayContaining([expect.objectContaining({ batchId: older })]));
  expect(
    row.official.sourceRefs.some((source) => source.kind === 'official_row' && newerRows.includes(source.id)),
  ).toBe(false);
  expect(row.official.withdrawnSourceRefs).toEqual(
    expect.arrayContaining(newerRows.map((id) => expect.objectContaining({ id, batchId: newer, status: 'withdrawn' }))),
  );
});

it('撤回订单资料不会撤回同日同词拉活的来源或金额', async () => {
  const entry = await word('撤回类型隔离');
  const orderId = await orders(entry, '2026-08-13', '4');
  await upload(`日期,渠道,关键词,拉活量\n2026-08-13,${entry.channel},${entry.name},2`, 'activation');
  const before = await one(entry, '2026-08-13', 'activation');
  await withdraw(orderId);
  expect((await one(entry, '2026-08-13')).official.status).toBe('withdrawn');
  const after = await one(entry, '2026-08-13', 'activation');
  expect(after.official).toEqual(before.official);
  expect(after.finance).toEqual(before.finance);
});

it('运营可读非金额核验但不能读财务字段，当前岗位变化重新执行投影', async () => {
  const entry = await word('财务岗位');
  await orders(entry, '2026-08-14', '4');
  const financial = await one(entry, '2026-08-14');
  expect(financial.finance).toMatchObject({ amount: '32.0000', currency: 'CNY' });
  expect(financial.result.status).toBe('ready');
  expect(financial.checks.historicalOwnership.status).toBe('ready');
  expect(financial.checks.projectParticipation.status).toBe('ready');
  const operational = await one(entry, '2026-08-14', 'new_user', operations);
  expect(operational).not.toHaveProperty('finance');
  expect(JSON.stringify(operational)).not.toContain('987654.3210');
  expect(operational.official.quantity).toBe('4');
  await connection.query("UPDATE users SET admin_duty='operations' WHERE id=?", [finance.sub]);
  try {
    const current = await one(entry, '2026-08-14');
    expect(current).not.toHaveProperty('finance');
    expect(JSON.stringify(current)).not.toContain('987654.3210');
  } finally {
    await connection.query("UPDATE users SET admin_duty='finance' WHERE id=?", [finance.sub]);
  }
});

it('原文件渠道别名采用规范渠道标识，不产生第二个业务键', async () => {
  const entry = await word('渠道别名');
  const alias = await resources.createMapping(admin, scope, nonce(), {
    channelId: '1',
    name: '核验渠道邮件别名',
    canonicalId: mappingId,
    from: '2026-07-01',
  });
  expect(alias.id).not.toBe(mappingId);
  await upload(`日期,渠道,关键词,订单量\n2026-08-15,核验渠道邮件别名,${entry.name},6`);
  const result = await evidence({
    from: '2026-08-15',
    to: '2026-08-15',
    channelRef: mappingId,
    taskRef: entry.id,
    metricType: 'new_user',
  });
  expect(result.total).toBe(1);
  expect(result.list[0].key.channelRef).toBe(mappingId);
  expect(result.list[0].official).toMatchObject({ status: 'ready', quantity: '6' });
});

it('渠道、任务、类型先过滤再分页，total稳定，越界空页仍说明范围内有记录', async () => {
  const distractor = await word('其他渠道干扰');
  const target = await word('分页目标', true);
  await orders(distractor, '2026-08-16', '99');
  await upload(
    `日期,渠道,关键词,订单量\n2026-08-16,${target.channel},${target.name},1\n2026-08-17,${target.channel},${target.name},2\n2026-08-18,${target.channel},${target.name},3`,
  );
  await upload(`日期,渠道,关键词,拉活量\n2026-08-16,${target.channel},${target.name},7`, 'activation');
  const filter = {
    from: '2026-08-16',
    to: '2026-08-18',
    channelRef: otherMappingId,
    taskRef: target.id,
    metricType: 'new_user',
  };
  const whole = await evidence(filter);
  expect(whole.total).toBe(3);
  const pages = await Promise.all([1, 2, 3].map((page) => evidence({ ...filter, page, pageSize: 1 })));
  for (const page of pages) {
    expect(page.total).toBe(3);
    expect(page.status).toBe('ready');
    expect(page.list).toHaveLength(1);
  }
  expect(pages.flatMap((page) => page.list.map((row) => row.key))).toEqual(whole.list.map((row) => row.key));
  expect(pages.flatMap((page) => page.list.map((row) => row.official.quantity)).sort()).toEqual(['1', '2', '3']);
  const outside = await evidence({ ...filter, page: 4, pageSize: 1 });
  expect(outside).toMatchObject({ status: 'ready', total: 3, list: [], page: 4, pageSize: 1 });
  const aliasFilter = await evidence({ ...filter, taskRef: target.id, keywordRef: target.id });
  expect(aliasFilter.list).toEqual(whole.list);
});

it('真实成员会话、失效岗位和跨项目来源不能读取管理核验，范围限制明确拒绝', async () => {
  const entry = await word('越权隔离');
  const filter = { from: '2026-08-20', to: '2026-08-20', taskRef: entry.id, metricType: 'new_user' };
  for (const actor of [creator, leader]) expect((await query(filter, actor)).status).toBe(403);
  expect((await query({ ...filter, projectId: '999999' })).status).toBe(403);
  expect((await query({ ...filter, accountId: '999999' })).status).toBe(403);
  expect((await query({ ...filter, from: '2026-08-01', to: '2026-09-01' })).status).toBe(422);
  expect((await query({ ...filter, pageSize: 101 })).status).toBe(422);
  await connection.query("UPDATE users SET role='creator' WHERE id=?", [finance.sub]);
  try {
    expect((await query(filter)).status).toBe(403);
  } finally {
    await connection.query("UPDATE users SET role='admin' WHERE id=?", [finance.sub]);
  }
});

it('读取核验与来源修正均保留已确认账，原账变化只能追加更正', async () => {
  const entry = await word('已确认原账');
  const date = '2026-08-21';
  await orders(entry, date, '3');
  const preview = await workbench.overview(finance, scope, { from: date, to: date });
  await workbench.confirmBills(finance, scope, { from: date, to: date }, nonce(), preview.reviewHash);
  const confirmed = await sql("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id");
  const ledger = await sql('SELECT * FROM opc_income_entries ORDER BY id');
  expect(confirmed.length).toBeGreaterThan(0);
  expect(ledger.length).toBeGreaterThan(0);
  const changedSource = await orders(entry, date, '5');
  await acceptNewSource(changedSource);
  expect((await one(entry, date)).official.quantity).toBe('5');
  expect(await sql("SELECT * FROM zh_statement_entries WHERE status='confirmed' ORDER BY id")).toEqual(confirmed);
  expect(await sql('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(ledger);
});

it('管理员本人执行无需伪造项目履历，当前升任管理员也不能豁免普通任务的历史缺口', async () => {
  const date = (await import('../../src/modules/zhihu/attribution/domain')).businessDay();
  const name = `管理员本人核验${++serial}`;
  const created = await resources.createKeyword(admin, scope, nonce(), {
    keyword: name,
    taskId: '1',
    mappingId,
    landingUrl: 'https://example.com/staff-evidence',
    popularizeType: 1,
  });
  await connection.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=? WHERE id=?", [
    `staff-evidence-${created.id}`,
    created.planId,
  ]);
  await resources.synchronizeKeywords(scope);
  const claimed = await request(app)
    .post(`/api/v1/modules/zhihu/keywords/${created.id}/claim`)
    .set(headers[admin.sub])
    .send({ ...scope, requestKey: nonce() });
  expect(claimed.status, claimed.text).toBe(200);
  const bindingId: string = claimed.body.data.id;
  const activated = await request(app)
    .post(`/api/v1/modules/zhihu/bindings/${bindingId}/activate`)
    .set(headers[admin.sub])
    .send({ ...scope, requestKey: nonce() });
  expect(activated.status, activated.text).toBe(200);
  const submitted = await request(app)
    .post('/api/v1/modules/zhihu/evidence')
    .set(headers[admin.sub])
    .send({
      ...scope,
      bindingId,
      requestKey: nonce(),
      url: 'https://example.com/staff-evidence-work',
      description: '管理员本人已发布作品',
    });
  expect(submitted.status, submitted.text).toBe(201);
  expect(await sql('SELECT path_type,executor_id FROM zh_keyword_bindings WHERE id=?', [bindingId])).toEqual([
    { path_type: 'staff_self', executor_id: Number(admin.sub) },
  ]);
  const entry: Word = { id: created.id, name, mappingId, channel: '核验渠道', bindingId };
  await orders(entry, date, '3');
  const row = await one(entry, date);
  expect(row.official).toMatchObject({ status: 'ready', quantity: '3' });
  expect(['not_applicable', 'ready']).toContain(row.checks.projectParticipation.status);
  expect(row.checks.work.status).toBe('ready');
  expect(row.checks.pricing.status).toBe('ready');
  expect(row.result.status).toBe('ready');
  expect(await sql('SELECT id FROM project_members WHERE user_id=?', [admin.sub])).toEqual([]);
  expect(await sql('SELECT id FROM project_membership_history WHERE user_id=?', [admin.sub])).toEqual([]);

  const ordinary = await word('普通任务未知参与', false, newlyPromoted);
  await orders(ordinary, '2026-08-22', '1');
  await connection.query("UPDATE users SET role='admin' WHERE id=?", [newlyPromoted.sub]);
  try {
    const unchangedPath = await one(ordinary, '2026-08-22');
    expect(unchangedPath.checks.projectParticipation.status).toBe('unknown');
    expect(unchangedPath.result.status).not.toBe('ready');
    expect(await sql('SELECT path_type FROM zh_keyword_bindings WHERE id=?', [ordinary.bindingId])).toEqual([
      { path_type: 'direct_creator' },
    ]);
    expect(await sql('SELECT id FROM project_membership_history WHERE user_id=?', [newlyPromoted.sub])).toEqual([]);
  } finally {
    await connection.query("UPDATE users SET role='creator' WHERE id=?", [newlyPromoted.sub]);
  }
});

it('渠道重名歧义与未识别渠道保留已到资料，沿原分析入口核对后恢复', async () => {
  const entry = await word('渠道歧义');
  await resources.createMapping(admin, scope, nonce(), {
    channelId: '2',
    canonicalId: otherMappingId,
    name: '核验 渠道',
    from: '2026-08-23',
    to: '2026-08-24',
  });
  const ambiguousBatch = await orders(entry, '2026-08-23', '4');
  const originalRows = await sql('SELECT id,raw_json,normalized_json FROM zh_import_rows WHERE batch_id=?', [
    ambiguousBatch,
  ]);
  const ambiguous = await one(entry, '2026-08-23');
  expect(ambiguous.official).toMatchObject({ status: 'conflict', quantity: null, coverageIsExhaustive: false });
  expect(ambiguous.result.status).not.toBe('ready');
  expect(ambiguous.result.nextAction).toMatchObject({
    method: 'GET',
    path: `${importEndpoint(ambiguousBatch)}/analysis`,
    requiredDuty: 'operations',
  });
  expect(ambiguous.official.sourceRefs).toEqual(
    expect.arrayContaining([expect.objectContaining({ batchId: ambiguousBatch, status: 'pending' })]),
  );

  const resolveChannel = async (batchId: string) => {
    const analysis = await request(app)
      .get(`${importEndpoint(batchId)}/analysis`)
      .set(headers[operations.sub])
      .query(scope);
    expect(analysis.status, analysis.text).toBe(200);
    const ask = analysis.body.data.steps[1].asks[0];
    expect(ask, analysis.text).toBeTruthy();
    const answered = await request(app)
      .post(`${importEndpoint(batchId)}/answers`)
      .set(headers[operations.sub])
      .send({
        ...scope,
        requestKey: nonce(),
        askId: ask.id,
        option: 'other-channel',
        selection: { mappingId },
      });
    expect(answered.status, answered.text).toBe(200);
  };
  await resolveChannel(ambiguousBatch);
  const repaired = await one(entry, '2026-08-23');
  expect(repaired.official).toMatchObject({ status: 'ready', quantity: '4' });
  expect(repaired.result.status).toBe('ready');
  expect(
    await sql('SELECT id,raw_json,normalized_json FROM zh_import_rows WHERE batch_id=?', [ambiguousBatch]),
  ).toEqual(originalRows);

  const unknownBatch = await upload(`日期,渠道,关键词,订单量\n2026-08-24,邮件里尚未登记的渠道,${entry.name},3`);
  const unknown = await one(entry, '2026-08-24');
  expect(unknown.official).toMatchObject({ status: 'unknown', quantity: null });
  expect(unknown.result.nextAction).toMatchObject({
    method: 'GET',
    path: `${importEndpoint(unknownBatch)}/analysis`,
    requiredDuty: 'operations',
  });
  await resolveChannel(unknownBatch);
  expect((await one(entry, '2026-08-24')).official).toMatchObject({ status: 'ready', quantity: '3' });
});
