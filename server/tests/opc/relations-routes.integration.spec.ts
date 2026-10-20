import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';

let container: StartedMySqlContainer, c: mysql.Connection, app: Express;
let db: typeof import('../../src/db').db;
const headers: Record<string, Record<string, string>> = {};
// 1 完整管理员；2 团长；3 达人（团长 2 邀请）；4 达人（达人 3 邀请，同属团长 2）；5 运营岗位；6 财务岗位；7 独立达人
const people = [
  { sub: '1', role: 'admin', adminDuty: 'all' },
  { sub: '2', role: 'leader', adminDuty: 'all' },
  { sub: '3', role: 'creator', adminDuty: 'all' },
  { sub: '4', role: 'creator', adminDuty: 'all' },
  { sub: '5', role: 'admin', adminDuty: 'operations' },
  { sub: '6', role: 'admin', adminDuty: 'finance' },
  { sub: '7', role: 'creator', adminDuty: 'all' },
] as const;
const get = (who: string | null, path: string, query: object = {}) => {
  const r = request(app).get('/api/v1/core/relations' + path).query(query);
  return who ? r.set(headers[who]) : r;
};

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withCommand(['--log-bin-trust-function-creators=1'])
    .withDatabase('core_relation_routes')
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
    NODE_ENV: 'test',
    OPC_MODULES: '',
    QUEUE_DRIVER: 'memory',
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    JWT_SECRET: 'relation_routes_isolated_secret_over_32_chars',
  });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  for (const person of people)
    await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name) VALUES(?,?,?,?,?,?)', [
      person.sub, 'user' + person.sub, 'unused', person.role, person.adminDuty, '人员' + person.sub,
    ]);
  await c.query('UPDATE users SET parent_id=2 WHERE id IN (3,4)');
  const dbModule = await import('../../src/db');
  db = dbModule.db;
  const rel = await import('../../src/core/member-relations');
  await dbModule.withTransaction(async (conn) => {
    for (const p of people) {
      const inviterId = p.sub === '3' ? '2' : p.sub === '4' ? '3' : null;
      await rel.recordRegistration(conn, {
        userId: p.sub,
        role: p.role,
        parentId: ['3', '4'].includes(p.sub) ? '2' : null,
        inviterId,
        channel: 'organic',
      });
    }
  });
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { createCoreApp } = await import('../../src/core/app');
  app = createCoreApp(new ModuleRuntime([]));
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  for (const person of people) {
    const client = 'relation-client-' + person.sub,
      session = await issueRefreshSession(person.sub, { type: 'web', id: client });
    headers[person.sub] = {
      'X-Client-Id': client,
      Authorization:
        'Bearer ' +
        (await signToken({ ...person, id: person.sub, username: 'user' + person.sub, displayName: '人员' + person.sub, parentId: null, sessionId: session.familyId })),
    };
  }
}, 90000);
afterAll(async () => {
  await db?.end();
  await c?.end();
  await container?.stop();
}, 30000);

it('达人和团长看自己的邀请关系：邀请人与名单昵称脱敏，只给人数，不含手机号', async () => {
  const creator = await get('3', '/mine');
  expect(creator.status, creator.text).toBe(200);
  expect(creator.body.data).toMatchObject({
    inviter: { name: '人*2' },
    team: { leaderName: '人员2' },
    counts: { direct: 1, indirect: 0 },
    directList: [{ name: '人*4', active: true }],
  });
  expect(creator.text).not.toContain('人员4');
  expect(creator.text).not.toContain('phone');
  const leader = await get('2', '/mine');
  expect(leader.body.data.counts).toEqual({ direct: 1, indirect: 1 });
  expect(leader.body.data.directList.map((x: { name: string }) => x.name)).toEqual(['人*3']);
  const independent = await get('7', '/mine');
  expect(independent.body.data).toMatchObject({ inviter: null, team: { leaderName: null }, counts: { direct: 0, indirect: 0 } });
});

it('拒绝未登录、后台岗位查看 /mine，以及多余参数', async () => {
  expect((await get(null, '/mine')).status).toBe(401);
  for (const who of ['1', '5']) expect((await get(who, '/mine')).status).toBe(403);
  expect((await get('3', '/mine', { userId: '2' })).status).toBe(422);
});

it('运营岗位查看成员三种关系与时间线；达人、团长和财务岗位被拒绝', async () => {
  const detail = await get('5', '/members/4');
  expect(detail.status, detail.text).toBe(200);
  expect(detail.body.data).toMatchObject({
    user: { id: '4', role: 'creator', active: true },
    referral: { inviter: { id: '3', name: '人员3' } },
    team: { leader: { id: '2', name: '人员2' } },
    counts: { direct: 0, indirect: 0 },
  });
  expect(detail.body.data.timeline.map((t: { kind: string }) => t.kind).sort()).toEqual(['role', 'team']);
  for (const who of ['2', '3', '6']) expect((await get(who, '/members/4')).status).toBe(403);
  expect((await get('5', '/members/999')).status).toBe(404);
  expect((await get('1', '/members/4')).status).toBe(200);
});

it('成员树按团队或邀请逐层加载；平台直管单列；拒绝非运营岗位与未知参数', async () => {
  const roots = await get('5', '/tree', { mode: 'team' });
  expect(roots.status, roots.text).toBe(200);
  expect(roots.body.data[0]).toMatchObject({ id: 'platform', children: 1 });
  expect(roots.body.data.find((n: { id: string }) => n.id === '2')).toMatchObject({ role: 'leader', children: 2 });
  expect((await get('5', '/tree', { mode: 'team', parent: '2' })).body.data.map((n: { id: string }) => n.id)).toEqual(['3', '4']);
  expect((await get('5', '/tree', { mode: 'team', parent: 'platform' })).body.data.map((n: { id: string }) => n.id)).toEqual(['7']);
  const inviteRoots = (await get('5', '/tree', { mode: 'invite' })).body.data.map((n: { id: string }) => n.id);
  expect(inviteRoots).toEqual(['2', '7']);
  expect((await get('5', '/tree', { mode: 'invite', parent: '2' })).body.data).toMatchObject([{ id: '3', children: 1 }]);
  expect((await get('5', '/tree', { mode: 'invite', parent: '3' })).body.data.map((n: { id: string }) => n.id)).toEqual(['4']);
  for (const who of ['2', '3', '6']) expect((await get(who, '/tree')).status).toBe(403);
  expect((await get('5', '/tree', { depth: '3' })).status).toBe(422);
});
