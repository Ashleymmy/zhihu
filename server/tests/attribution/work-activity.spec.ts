import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import { importOptionsSchema } from '../../src/modules/zhihu/services/composition-import-parser';

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
let imports: typeof import('../../src/modules/zhihu/services/composition-import.service');
let plans: typeof import('../../src/modules/zhihu/services/plans.service');
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
    .withDatabase('claimed_composition_test')
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
  imports = await import('../../src/modules/zhihu/services/composition-import.service');
  plans = await import('../../src/modules/zhihu/services/plans.service');
  mappingId = (
    await resources.createMapping(admin, scope, crypto.randomUUID(), {
      channelId: '1',
      name: '渠道',
      from: '2020-01-01',
    })
  ).id;
  const { compositionsRouter } = await import('../../src/modules/zhihu/routes/compositions');
  const { plansRouter } = await import('../../src/modules/zhihu/routes/plans');
  const { errorHandler } = await import('../../src/middleware/errors');
  app = express()
    .use(express.json())
    .use('/compositions', compositionsRouter)
    .use('/activity', (await import('../../src/modules/zhihu/routes/attribution')).attributionRouter)
    .use('/plans', plansRouter)
    .use(errorHandler);
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

const period = { from: '2026-10-01', to: '2026-10-03' };
let activity: typeof import('../../src/modules/zhihu/attribution/works'),
  ids: string[] = [],
  word: any;
beforeAll(async () => {
  activity = await import('../../src/modules/zhihu/attribution/works');
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(6,'zero','unused','creator','零作品成员',2)",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,6)');
  for (const [executor, status, date] of [
    [team, 'synced', '2026-10-01 00:00:00'],
    [team, 'failed', '2026-10-03 23:59:59'],
    [team, 'local', '2026-10-02 12:00:00'],
    [leader, 'synced', '2026-10-02 12:00:00'],
    [direct, 'synced', '2026-10-02 12:00:00'],
    [other, 'synced', '2026-10-02 12:00:00'],
    [team, 'synced', '2026-09-30 23:59:59'],
    [team, 'synced', '2026-10-04 00:00:00'],
  ] as const) {
    const k = await keyword(executor);
    const saved = await works.createComposition(executor, input(k.planId));
    ids.push(saved.id);
    await c.query('UPDATE compositions SET created_at=?,sync_status=? WHERE id=?', [date, status, saved.id]);
    if (ids.length === 1) word = k;
  }
}, 90000);
it('self/team counts distinguish failures and use inclusive China-date boundaries', async () => {
  const own = await activity.workActivity(team, scope, { ...period, view: 'self' }, 1, 25);
  expect(own.summary).toEqual({ registered: 3, submitted: 1, failed: 1, pending: 1 });
  expect((await activity.workActivity(leader, scope, { ...period, view: 'self' }, 1, 25)).summary.registered).toBe(1);
  const group = await activity.workActivity(leader, scope, { ...period, view: 'team' }, 1, 25);
  expect(group.summary).toEqual(own.summary);
  expect(group.list.map((x) => String(x.id))).toEqual(['3', '6']);
  expect(group.list[1].registered).toBe(0);
});
it('project totals equal member totals and result/member drilldown totals', async () => {
  const all = await activity.workActivity(admin, scope, { ...period, view: 'all' }, 1, 25);
  expect(all.summary).toEqual({ registered: 6, submitted: 4, failed: 1, pending: 1 });
  expect(all.list.reduce((s, r) => s + Number(r.registered), 0)).toBe(6);
  for (const m of all.list)
    expect(
      (await activity.listWorks(admin, scope, 1, 25, { ...period, registeredOnly: true, ownerId: String(m.id) })).total,
    ).toBe(m.registered);
  for (const result of ['submitted', 'failed', 'pending'] as const)
    expect((await activity.listWorks(admin, scope, 1, 25, { ...period, registeredOnly: true, result })).total).toBe(
      all.summary[result],
    );
});
it('pagination preserves totals and produces distinct records', async () => {
  const a = await activity.workActivity(admin, scope, { ...period, view: 'all' }, 1, 2),
    b = await activity.workActivity(admin, scope, { ...period, view: 'all' }, 2, 2);
  expect(a.total).toBe(5);
  expect(a.summary).toEqual(b.summary);
  expect(new Set([...a.list, ...b.list].map((x) => x.id)).size).toBe(4);
  const first = await activity.listWorks(team, scope, 1, 2, { ...period, registeredOnly: true }),
    next = await activity.listWorks(team, scope, 2, 2, { ...period, registeredOnly: true });
  expect(first.total).toBe(3);
  expect(new Set([...first.list, ...next.list].map((x) => x.composition_id)).size).toBe(3);
});
it('forged filters cannot expand role visibility', async () => {
  expect((await activity.workActivity(team, scope, { ...period, view: 'all' }, 1, 25)).summary.registered).toBe(3);
  expect((await activity.workActivity(leader, scope, { ...period, ownerId: '4' }, 1, 25)).summary.registered).toBe(0);
  expect((await activity.listWorks(team, scope, 1, 25, { ownerId: '4' })).total).toBe(0);
  for (const actor of [team, leader])
    await expect(activity.workDetail(actor, scope, 'composition:' + ids[4])).rejects.toMatchObject({ httpStatus: 404 });
});
it('details expose complete context but finance staff cannot edit', async () => {
  const detail = await activity.workDetail(leader, scope, 'composition:' + ids[0]);
  expect(detail.executor_name).toBe('团队达人');
  expect(detail.task_name).toBe('任务');
  expect(detail.composition_type).toBe(1);
  expect(detail.release_time).toBeTruthy();
  expect(detail.can_edit).toBe(true);
  expect((await activity.workDetail({ ...admin, adminDuty: 'finance' }, scope, 'composition:' + ids[0])).can_edit).toBe(
    false,
  );
});
it('wrong project/account and unknown record are denied', async () => {
  await expect(
    activity.workDetail(admin, { ...scope, projectId: '999' }, 'composition:' + ids[0]),
  ).rejects.toMatchObject({ httpStatus: 403 });
  await expect(activity.workActivity(admin, { ...scope, accountId: '999' }, period, 1, 25)).rejects.toMatchObject({
    httpStatus: 403,
  });
  await expect(activity.workDetail(admin, scope, 'composition:999999')).rejects.toMatchObject({ httpStatus: 404 });
});
it('duplicate linked evidence never inflates workload', async () => {
  const [[comp]] = await c.query<RowDataPacket[]>('SELECT promo_url FROM compositions WHERE id=?', [ids[0]]);
  for (let n = 0; n < 2; n++)
    await c.query(
      "INSERT INTO zh_evidence(binding_id,work_url,description,status,submitted_by) VALUES(?,?,?,'pending',?)",
      [word.bindingId, comp.promo_url, '历史凭据', '3'],
    );
  const data = await activity.listWorks(team, scope, 1, 25, { ...period, registeredOnly: true });
  expect(data.total).toBe(3);
  expect(data.list.filter((x) => String(x.composition_id) === ids[0])).toHaveLength(1);
  expect((await activity.workActivity(team, scope, period, 1, 25)).summary.registered).toBe(3);
  expect(String((await activity.workDetail(team, scope, 'composition:' + ids[0])).composition_id)).toBe(ids[0]);
});
it('editing and retrying do not increment registered count', async () => {
  const before = await activity.workActivity(team, scope, period, 1, 25);
  await c.query("UPDATE compositions SET sync_status='synced',updated_at=NOW(),title='已修正' WHERE id=?", [ids[1]]);
  const after = await activity.workActivity(team, scope, period, 1, 25);
  expect(after.summary.registered).toBe(before.summary.registered);
  expect(after.summary.failed).toBe(0);
  expect(after.summary.submitted).toBe(2);
});
it('routes reject invalid dates, reversed range and malformed identifiers', async () => {
  actor = admin;
  for (const q of [{ from: '2026-02-30' }, { from: '2026-10-03', to: '2026-10-01' }, { ownerId: 'bad' }])
    expect(
      (
        await request(app)
          .get('/activity/workbench/work-activity')
          .query({ ...scope, ...q })
      ).status,
    ).toBe(422);
  expect(
    (
      await request(app)
        .get('/activity/workbench/work-detail')
        .query({ ...scope, id: '../1' })
    ).status,
  ).toBe(422);
  const good = await request(app)
    .get('/activity/workbench/work-activity')
    .query({ ...scope, ...period, view: 'self' });
  expect(good.status, JSON.stringify(good.body)).toBe(200);
});
