import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection } from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthUser } from '../../src/types';
import { runOpcMigrations } from '../../scripts/opcMigrations';
vi.mock('../../src/modules/zhihu/queue', async (original) => ({
  ...(await original<typeof import('../../src/modules/zhihu/queue')>()),
  enqueue: vi.fn(async () => ({ id: 'isolated' })),
}));
let container: StartedMySqlContainer,
  c: Connection,
  pool: typeof import('../../src/db').db,
  app: Express,
  resources: typeof import('../../src/modules/zhihu/attribution/resources');
const key = () => crypto.randomUUID(),
  scope = { projectId: '1', accountId: '' };
const user = (
  sub: string,
  role: AuthUser['role'],
  duty: AuthUser['adminDuty'] = 'all',
  parentId: string | null = null,
): AuthUser => ({
  sub,
  role,
  adminDuty: duty,
  parentId,
  displayName: '人员' + sub,
  username: 'tasks' + sub,
  jti: key(),
});
const admin = user('1', 'admin'),
  leader = user('2', 'leader'),
  creator = user('3', 'creator', 'all', '2'),
  independent = user('4', 'creator'),
  ops = user('5', 'admin', 'operations'),
  finance = user('6', 'admin', 'finance'),
  stranger = user('7', 'creator');
const headers: Record<string, Record<string, string>> = {};
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
let mappingId = '',
  failedId = '',
  availableId = '',
  assignedId = '',
  assignedPlan = '',
  assignedBinding = '',
  historicalId = '';
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('platform_tasks_test')
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
  c = await mysql.createConnection(target);
  for (const actor of [admin, leader, creator, independent, ops, finance, stranger])
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,display_name,admin_duty,parent_id) VALUES(?,?,?,?,?,?,?)',
      [actor.sub, actor.username, 'unused', actor.role, actor.displayName, actor.adminDuty, actor.parentId],
    );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4)');
  scope.accountId = String((await q('SELECT id FROM integration_accounts LIMIT 1'))[0].id);
  await c.query(
    "INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'task-channel',1,'任务渠道'),(2,1,'task-channel2',1,'另一个渠道')",
  );
  await c.query(
    "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task-activity','推广活动一',NOW()),(2,1,'task-activity2','推广活动二',NOW())",
  );
  resources = await import('../../src/modules/zhihu/attribution/resources');
  pool = (await import('../../src/db')).db;
  mappingId = (
    await resources.createMapping(admin, scope, key(), { channelId: '1', name: '任务渠道', from: '2026-01-01' })
  ).id;
  await resources.createMapping(admin, scope, key(), { channelId: '2', name: '另一个渠道', from: '2026-01-01' });
  for (const [word, status] of [
    ['失败任务', 'failed'],
    ['大厅任务', 'synced'],
    ['团队任务', 'synced'],
    ['历史缺人任务', 'synced'],
  ] as const) {
    const k = await resources.createKeyword(admin, scope, key(), {
      keyword: word,
      taskId: '1',
      mappingId,
      landingUrl: 'https://www.zhihu.com/story/1',
      popularizeType: 1,
      novel: { title: '原来的小说', url: 'https://www.zhihu.com/story/2' },
    });
    await c.query("UPDATE plans SET sync_status=?,status='active',zhihu_plan_id=?,sync_error=? WHERE id=?", [
      status,
      status === 'failed' ? null : 'upstream-' + k.id,
      status === 'failed' ? '关键词不符合规则' : null,
      k.planId,
    ]);
    if (status === 'failed') failedId = k.id;
    if (word === '大厅任务') availableId = k.id;
    if (word === '历史缺人任务') historicalId = k.id;
    if (word === '团队任务') {
      assignedId = k.id;
      assignedPlan = k.planId;
    }
  }
  await resources.synchronizeKeywords(scope);
  await c.query('UPDATE zh_keywords SET priority_until=DATE_SUB(NOW(),INTERVAL 1 HOUR)');
  assignedBinding = (await resources.distribute(admin, scope, assignedId, key(), leader.sub)).id;
  await resources.changeBinding(leader, scope, assignedBinding, key(), { action: 'assign', executorId: creator.sub });
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { zhihuManifest } = await import('../../src/modules/zhihu/manifest'),
    { createZhihuModule } = await import('../../src/modules/zhihu/module'),
    { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register(createZhihuModule());
  app = createCoreApp(runtime);
  const { signToken } = await import('../../src/auth/jwt'),
    { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  for (const actor of [admin, leader, creator, independent, ops, finance, stranger]) {
    const client = 'task-zhihu-client-' + actor.sub,
      session = await issueRefreshSession(actor.sub, { type: 'web', id: client });
    headers[actor.sub] = {
      'X-Client-Id': client,
      Authorization: 'Bearer ' + (await signToken({ ...actor, id: actor.sub, sessionId: session.familyId })),
    };
  }
}, 90000);
afterAll(async () => {
  delete process.env.ZHIHU_ACTIVATION_ENABLED;
  await pool?.end();
  await c?.end();
  await container?.stop();
});
const base = (id: string) => `/api/v1/core/tasks/zhihu/${scope.accountId}/${id}`;
const detail = (id: string, u: AuthUser = admin) =>
  request(app).get(base(id)).set(headers[u.sub]).query({ projectId: scope.projectId });
const action = (id: string, name: string, input: Record<string, unknown>, u: AuthUser = admin) =>
  request(app)
    .post(base(id) + '/actions/' + name)
    .set(headers[u.sub])
    .send({ projectId: scope.projectId, requestKey: key(), input });
const list = (u: AuthUser, view = 'owned') =>
  request(app).get('/api/v1/core/tasks').set(headers[u.sub]).query({ view });
it('returns usable halls and own/team tasks with names, novel context and immediate next actions', async () => {
  const r = await list(creator);
  expect(r.status, r.text).toBe(200);
  expect(r.body.data.groups[0].list).toHaveLength(1);
  expect(r.body.data.groups[0].list[0]).toMatchObject({
    id: assignedId,
    title: '团队任务',
    subtitle: '原来的小说',
    executor: '人员3',
    leader: '人员2',
    status: { key: 'assigned' },
    next: { action: { key: 'submit-work' } },
  });
  expect((await list(leader)).body.data.groups[0].list[0].id).toBe(assignedId);
  expect((await list(creator, 'available')).body.data.groups[0].list).toHaveLength(0);
  const hall = (await list(independent, 'available')).body.data.groups[0].list;
  expect(hall.some((t: { id: string }) => t.id === availableId)).toBe(true);
  expect(hall.some((t: { id: string }) => t.id === failedId || t.id === assignedId)).toBe(false);
  expect(hall.find((t: { id: string }) => t.id === availableId).metrics).toEqual(
    expect.arrayContaining([
      { label: '当前拉新单价', value: '8.0000 元/单' },
      { label: '当前拉活单价', value: '1.2000 元/个' },
    ]),
  );
});
it('rejects nonmember, other creator, finance and conflicting actions at HTTP boundary', async () => {
  expect((await list(stranger)).body.data.groups).toHaveLength(0);
  for (const r of [
    await detail(assignedId, stranger),
    await detail(assignedId, finance),
    await action(assignedId, 'assign', { executorId: '4' }, finance),
  ])
    expect(r.status).toBe(403);
  expect((await detail(assignedId, independent)).status).toBe(404);
  expect((await action(assignedId, 'assign', { executorId: '4' }, creator)).status).toBe(403);
  expect((await action(assignedId, 'assign', { executorId: '4' }, leader)).status).toBe(403);
});
it('prefills every original field but permits editing activity, channel, novel and link as well as keyword', async () => {
  const d = (await detail(failedId, ops)).body.data,
    edit = d.actions.find((a: { key: string }) => a.key === 'edit-retry');
  expect(edit.fields.map((f: { key: string }) => f.key)).toEqual([
    'keyword',
    'taskId',
    'mappingId',
    'landingUrl',
    'novelTitle',
    'novelUrl',
  ]);
  expect(edit.fields.find((f: { key: string }) => f.key === 'novelTitle').value).toBe('原来的小说');
  const mapping = (await q("SELECT id FROM zh_channel_mappings WHERE channel_name='另一个渠道'"))[0];
  const r = await action(
    failedId,
    'edit-retry',
    {
      keyword: '更正后的任务',
      taskId: '2',
      mappingId: String(mapping.id),
      landingUrl: 'https://www.zhihu.com/story/3',
      novelTitle: '新的小说',
      novelUrl: 'https://www.zhihu.com/story/4',
    },
    ops,
  );
  expect(r.status, r.text).toBe(200);
  const [saved] = await q(
    'SELECT p.keyword,p.zhihu_task_id,p.channel_id,p.landing_url,p.novel_title,p.novel_url,p.sync_status FROM plans p JOIN zh_keywords k ON k.plan_id=p.id WHERE k.id=?',
    [failedId],
  );
  expect(saved).toMatchObject({
    keyword: '更正后的任务',
    zhihu_task_id: 'task-activity2',
    channel_id: 'task-channel2',
    novel_title: '新的小说',
    novel_url: 'https://www.zhihu.com/story/4',
    sync_status: 'local',
  });
});
it('allows exactly one concurrent claim and keeps used keywords out of the hall', async () => {
  const rs = await Promise.all([
    action(availableId, 'claim', {}, leader),
    action(availableId, 'claim', {}, independent),
  ]);
  expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
  expect(rs.filter((r) => r.status !== 200).every((r) => [403, 409].includes(r.status))).toBe(true);
  expect(await q('SELECT id FROM zh_keyword_bindings WHERE keyword_id=?', [availableId])).toHaveLength(1);
  expect(
    (await list(independent, 'available')).body.data.groups[0].list.some((t: { id: string }) => t.id === availableId),
  ).toBe(false);
});
it('shows automatic work checks, scoped historical evidence, separate activity quantities and no operations amounts', async () => {
  const before = (await detail(assignedId, creator)).body.data;
  expect(before.progress.find((p: { status: string }) => p.status === 'current').label).toBe('交作品');
  expect(before.progress.find((p: { label: string }) => p.label === '核验').description).toContain('无需逐条人工审批');
  await resources.changeBinding(creator, scope, assignedBinding, key(), { action: 'activate' });
  const statements = await import('../../src/modules/zhihu/attribution/statements');
  const e = await statements.submitEvidence(creator, scope, key(), {
    bindingId: assignedBinding,
    url: 'https://www.douyin.com/video/123',
    description: '历史作品',
  });
  await statements.reviewEvidence(admin, scope, e.id, key(), true, '作品链接有效');
  const date = (await import('../../src/modules/zhihu/attribution/domain')).businessDay(),
    workbench = await import('../../src/modules/zhihu/attribution/workbench');
  const file = (text: string) => {
    const buffer = Buffer.from(text);
    return { originalname: 'task.csv', mimetype: 'text/csv', buffer, size: buffer.length };
  };
  await workbench.uploadReport(finance, scope, file(`日期,渠道,关键词,订单量\n${date},任务渠道,团队任务,3`));
  await workbench.uploadReport(
    finance,
    scope,
    file(`日期,渠道,关键词,拉活量,结算金额\n${date},任务渠道,团队任务,5,10`),
    'activation',
  );
  const d = (await detail(assignedId, creator)).body.data;
  expect(d.metrics).toEqual(
    expect.arrayContaining([
      { label: '已交作品', value: '1 篇' },
      { label: '本月拉新', value: '3 单' },
      { label: '本月拉活', value: '5 个' },
    ]),
  );
  expect(d.progress.find((p: { status: string }) => p.status === 'current').label).toBe('确认');
  const op = (await detail(assignedId, ops)).body.data;
  expect(op.progress).toHaveLength(5);
  expect(JSON.stringify(op)).not.toMatch(/unitPrice|unit_price|payable|billableAmount|¥/);
  await c.query(
    "INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url,sync_status,sync_error) VALUES(?,3,1,'test',1,1,'https://www.douyin.com/video/123','failed','作品链接无法访问')",
    [assignedPlan],
  );
  const failed = (await detail(assignedId, creator)).body.data;
  expect(failed.status.key).toBe('work-failed');
  expect(failed.next.action.key).toBe('works');
  expect(failed.metrics[0]).toEqual({ label: '已交作品', value: '1 篇' });
});
it('assigns report-only historical usage inline and recalculates without a second upload', async () => {
  const date = (await import('../../src/modules/zhihu/attribution/domain')).businessDay(),
    workbench = await import('../../src/modules/zhihu/attribution/workbench'),
    buffer = Buffer.from(`日期,渠道,关键词,订单量\n${date},任务渠道,历史缺人任务,2`);
  await workbench.uploadReport(finance, scope, {
    originalname: 'historical.csv',
    mimetype: 'text/csv',
    buffer,
    size: buffer.length,
  });
  const before = (await detail(historicalId, ops)).body.data;
  expect(before.actions.find((a: { key: string }) => a.key === 'resolve-owner').fields[0].key).toBe('executorId');
  expect(before.status.label).toBe('没有执行人');
  const r = await action(historicalId, 'resolve-owner', { executorId: '4' }, ops);
  expect(r.status, r.text).toBe(200);
  expect((await detail(historicalId, independent)).body.data.executor).toBe('人员4');
  expect(
    (
      await q(
        'SELECT r.snapshot_json FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id WHERE f.keyword_id=?',
        [historicalId],
      )
    )[0].snapshot_json,
  ).toBeTruthy();
  expect((await action(historicalId, 'resolve-owner', { executorId: '3' }, ops)).status).toBe(403);
});

it('continues historical work submission, return and verification inside task details without normal-work approval', async () => {
  await c.query(
    "UPDATE plans p JOIN zh_keywords k ON k.plan_id=p.id SET p.sync_status='historical',k.legacy_mode='historical_registered' WHERE k.id=?",
    [historicalId],
  );
  const d = await detail(historicalId, independent);
  expect(d.status, d.text).toBe(200);
  expect(d.body.data.next.action.key).toBe('history-submit');
  expect(
    (
      await action(
        historicalId,
        'history-submit',
        { url: 'https://www.douyin.com/video/77', description: '历史已发布作品' },
        independent,
      )
    ).status,
  ).toBe(200);
  const waiting = (await detail(historicalId, independent)).body.data;
  expect(waiting.status.label).toBe('历史作品待核验');
  expect(waiting.actions.some((a: { key: string }) => a.key === 'history-accept')).toBe(false);
  expect((await action(historicalId, 'history-accept', {}, independent)).status).toBe(403);
  expect((await action(historicalId, 'history-return', { reason: '补充完整作品链接' }, ops)).status).toBe(200);
  const returned = (await detail(historicalId, independent)).body.data;
  expect(returned.next.text).toBe('补充完整作品链接');
  expect(returned.next.action.key).toBe('history-submit');
  expect(returned.actions.find((a: { key: string }) => a.key === 'history-submit').fields[0].value).toBe(
    'https://www.douyin.com/video/77',
  );
  expect(
    (
      await action(
        historicalId,
        'history-submit',
        { url: 'https://www.douyin.com/video/78', description: '补充后的历史作品' },
        independent,
      )
    ).status,
  ).toBe(200);
  expect((await action(historicalId, 'history-accept', {}, ops)).status).toBe(200);
  expect(
    (await detail(historicalId, independent)).body.data.progress.find((p: { label: string }) => p.label === '核验')
      .status,
  ).toBe('done');
  const { enqueue } = await import('../../src/modules/zhihu/queue');
  expect(vi.mocked(enqueue).mock.calls.some((call) => String(call[0]).includes('composition'))).toBe(false);
});
