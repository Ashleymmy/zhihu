import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';

vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'test' })) }));
let actor: AuthUser;
vi.mock('../../src/auth/middleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = actor;
    next();
  },
}));
const user = (sub: string, role: AuthUser['role'], parentId: string | null = null): AuthUser => ({
  sub,
  role,
  parentId,
  username: 'user' + sub,
  displayName: 'user' + sub,
  jti: 'isolated-test',
});
const admin = user('1', 'admin'),
  leader = user('2', 'leader'),
  team = user('3', 'creator', '2'),
  direct = user('4', 'creator'),
  other = user('5', 'creator');
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db;
let resources: typeof import('../../src/modules/zhihu/attribution/resources');
let works: typeof import('../../src/modules/zhihu/services/compositions.service');
let app: express.Express,
  scope = { projectId: '1', accountId: '' },
  mappingId = '',
  serial = 0;
const input = (planId: string) => ({
  planId,
  mediaType: 'KOC小红书',
  mediaAccount: 'test-only',
  compositionType: 1,
  compositionSubType: 1,
  promoUrl: 'https://example.com/work/' + ++serial,
  releaseTime: '2026-09-29T12:00:00+08:00',
});
async function keyword(executor?: AuthUser) {
  const item = await resources.createKeyword(admin, scope, crypto.randomUUID(), {
    keyword: '登记回归' + ++serial,
    taskId: '1',
    mappingId,
    landingUrl: 'https://example.com',
    popularizeType: 0,
  });
  await c.query("UPDATE plans SET status='active',sync_status='synced',zhihu_plan_id=? WHERE id=?", [
    'upstream-' + item.planId,
    item.planId,
  ]);
  await c.query('UPDATE zh_keywords SET priority_until=TIMESTAMPADD(HOUR,-1,NOW()) WHERE id=?', [item.id]);
  await resources.synchronizeKeywords(scope, item.planId);
  let bindingId = '';
  if (executor) {
    const claimant = executor === team || executor === leader ? leader : executor;
    bindingId = (await resources.claim(claimant, scope, item.id, crypto.randomUUID())).id;
    if (claimant === leader)
      await resources.changeBinding(leader, scope, bindingId, crypto.randomUUID(), {
        action: 'assign',
        executorId: executor.sub,
      });
  }
  return { ...item, bindingId };
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('member_activity_test')
    .withUsername('test')
    .withUserPassword('isolated_test')
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
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(1,'admin','unused','admin','管理员',NULL),(2,'leader','unused','leader','团长',NULL),(3,'team','unused','creator','团队达人',2),(4,'direct','unused','creator','天舒回归',NULL),(5,'other','unused','creator','他人',NULL)",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5)');
  const [accounts] = await c.query<RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
  scope.accountId = String(accounts[0].id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'channel',1,'渠道')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task','任务',NOW())");
  pool = (await import('../../src/db')).db;
  resources = await import('../../src/modules/zhihu/attribution/resources');
  works = await import('../../src/modules/zhihu/services/compositions.service');
  mappingId = (
    await resources.createMapping(admin, scope, crypto.randomUUID(), {
      channelId: '1',
      name: '渠道',
      from: '2020-01-01',
    })
  ).id;
  const { errorHandler } = await import('../../src/middleware/errors');
  const { ModuleRuntime } = await import('../../src/core/module-runtime');
  const { zhihuManifest } = await import('../../src/modules/zhihu/manifest');
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register({
    manifest: zhihuManifest,
    router: express.Router(),
    dataProvider: {
      memberActivity: (await import('../../src/modules/zhihu/attribution/member-activity')).memberActivity,
      ...(await import('../../src/modules/zhihu/attribution/provider')).attributionDataProvider,
    },
  });
  app = express()
    .use(express.json())
    .use(
      '/core/member-activity',
      (req, _res, next) => {
        req.user = actor;
        next();
      },
      (await import('../../src/core/member-activity-routes')).createMemberActivityRouter(runtime),
    )
    .use(errorHandler);
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

const endpoint = '/core/member-activity';
async function summary(ids = ['2', '3', '4', '5']) {
  const r = await request(app)
    .post(endpoint + '/summary')
    .send({ memberIds: ids });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}
async function detail(memberId = '3', extra: Record<string, unknown> = {}) {
  const r = await request(app)
    .get(endpoint + '/' + memberId)
    .query({ moduleId: 'zhihu', kind: 'tasks', ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}
let primary: Awaited<ReturnType<typeof keyword>>,
  released: Awaited<ReturnType<typeof keyword>>,
  returned: Awaited<ReturnType<typeof keyword>>;
beforeAll(async () => {
  primary = await keyword(team);
  released = await keyword(team);
  returned = await keyword(team);
  await c.query(
    "UPDATE zh_keyword_bindings SET verification_status='passed',assigned_at='2026-10-01 00:00:00' WHERE id=?",
    [primary.bindingId],
  );
  await c.query(
    "UPDATE zh_keyword_bindings SET released_at='2026-10-02 12:00:00',assigned_at='2026-10-02 11:00:00' WHERE id=?",
    [released.bindingId],
  );
  await c.query("UPDATE zh_keyword_bindings SET assigned_at='2026-10-03 23:59:59' WHERE id=?", [returned.bindingId]);
  const good = await works.createComposition(team, input(primary.planId)),
    bad = await works.createComposition(team, input(returned.planId));
  await c.query(
    "UPDATE compositions SET created_at='2026-10-01 00:00:00',sync_status='synced',zhihu_status_json=JSON_OBJECT('auditStatus','approved') WHERE id=?",
    [good.id],
  );
  await c.query(
    "UPDATE compositions SET created_at='2026-10-03 23:59:59',sync_status='failed',sync_error='request timeout' WHERE id=?",
    [bad.id],
  );
  const [[composition]] = await c.query<RowDataPacket[]>('SELECT promo_url FROM compositions WHERE id=?', [good.id]);
  // Repeated evidence for the same submitted work must still count only once.
  for (let n = 0; n < 2; n++)
    await c.query(
      "INSERT INTO zh_evidence(binding_id,work_url,description,submitted_by,status) VALUES(?,?,'重复核验凭据',3,'approved')",
      [primary.bindingId, composition.promo_url],
    );
  await keyword(other);
  await c.query("UPDATE zh_keyword_bindings SET verification_status='passed' WHERE id=?", [primary.bindingId]);
  await c.query("UPDATE plans SET novel_title='检索小说原名' WHERE id=?", [primary.planId]);
}, 90000);

it('counts actual personal assignments, keeps released history, and deduplicates works', async () => {
  actor = admin;
  const r = await summary();
  expect(r.totals['3']).toEqual({ tasks: 3, currentTasks: 2, verifiedTasks: 1, works: 2 });
  expect(r.totals['2']).toEqual({ tasks: 0, currentTasks: 0, verifiedTasks: 0, works: 0 });
  expect(r.totals['4']).toEqual({ tasks: 0, currentTasks: 0, verifiedTasks: 0, works: 0 });
  for (const [status, key] of [
    ['all', 'tasks'],
    ['current', 'currentTasks'],
    ['verified', 'verifiedTasks'],
  ] as const)
    expect((await detail('3', { status })).total).toBe(r.totals['3'][key]);
  expect((await detail('3', { kind: 'works' })).total).toBe(r.totals['3'].works);
  expect((await detail('3', { status: 'released' })).list[0].status).toBe('已释放');
});
it('rejects non-management roles and finance duty on both endpoints, even forged member/project filters', async () => {
  for (const forbidden of [leader, team, direct, user('1', 'operator'), { ...admin, adminDuty: 'finance' as const }]) {
    actor = forbidden;
    expect(
      (
        await request(app)
          .post(endpoint + '/summary')
          .send({ memberIds: ['3'], projectId: '1' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(endpoint + '/3')
          .query({ moduleId: 'zhihu', kind: 'works' })
      ).status,
    ).toBe(403);
  }
  for (const permitted of [{ ...admin, adminDuty: 'operations' as const }, user('1', 'developer')]) {
    actor = permitted;
    expect((await summary()).totals['3'].works).toBe(2);
    const r = await detail('3', { kind: 'works' });
    expect(JSON.stringify(r)).not.toMatch(/unitPrice|unit_price|amount|income|password|sync_error/);
  }
});
it('rejects unknown members and project/module scope and invalid date ranges instead of showing false zero', async () => {
  actor = admin;
  expect(
    (
      await request(app)
        .post(endpoint + '/summary')
        .send({ memberIds: ['999999'] })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .get(endpoint + '/999999')
        .query({ moduleId: 'zhihu' })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .post(endpoint + '/summary')
        .send({ memberIds: ['3'], projectId: '999999' })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .get(endpoint + '/3')
        .query({ moduleId: 'missing' })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .get(endpoint + '/3')
        .query({ moduleId: 'zhihu', from: '2026-10-10', to: '2026-10-01' })
    ).status,
  ).toBe(422);
  expect(
    (
      await request(app)
        .post(endpoint + '/summary')
        .send({ memberIds: Array(101).fill('3') })
    ).status,
  ).toBe(422);
});
it('paginates without duplicates and searches keywords, original titles and work links', async () => {
  actor = admin;
  const a = await detail('3', { page: 1, pageSize: 2 }),
    b = await detail('3', { page: 2, pageSize: 2 });
  expect(a.total).toBe(3);
  expect(b.total).toBe(3);
  expect(new Set([...a.list, ...b.list].map((r) => r.id)).size).toBe(3);
  expect((await detail('3', { search: '检索小说原名' })).list.map((r: { taskRef: string }) => r.taskRef)).toEqual([
    primary.planId,
  ]);
  expect((await detail('3', { kind: 'works', search: '检索小说原名' })).total).toBe(1);
  const work = await detail('3', { kind: 'works', taskRef: primary.planId });
  expect(work.total).toBe(1);
  expect(work.list[0].url).toMatch(/^https:\/\/example.com/);
  expect(work.list[0].fields).toContainEqual({ label: '知乎审核', value: '已通过' });
  expect((await detail('5', { kind: 'works', taskRef: primary.planId })).total).toBe(0);
});
it('uses inclusive date boundaries and preserves recorded ownership after a team transfer', async () => {
  actor = admin;
  expect((await detail('3', { from: '2026-10-01', to: '2026-10-03' })).total).toBe(3);
  expect((await detail('3', { kind: 'works', from: '2026-10-03', to: '2026-10-03' })).total).toBe(1);
  await c.query('UPDATE users SET parent_id=NULL WHERE id=3');
  await c.query('UPDATE project_members SET left_at=NOW() WHERE user_id=3');
  const r = await detail('3', { taskRef: primary.planId });
  expect(r.list[0].fields).toContainEqual({ label: '记录中的团长', value: '团长' });
  expect((await summary()).totals['3'].tasks).toBe(3);
  const [rows] = await c.query<RowDataPacket[]>('SELECT executor_id,leader_id FROM zh_keyword_bindings WHERE id=?', [
    primary.bindingId,
  ]);
  expect(Number(rows[0].executor_id)).toBe(3);
  expect(Number(rows[0].leader_id)).toBe(2);
});
