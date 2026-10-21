import { beforeAll, afterAll, it, expect } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { ModuleRuntime } from '../../src/core/module-runtime';
let container: StartedMySqlContainer, c: mysql.Connection, pool: typeof import('../../src/db').db, app: Express;
let passwordHash: string,
  sequence = 0;
type Actor = { id: string; name: string; headers: Record<string, string> };
const base = '/api/v1/core/team/member-changes';
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('member_changes_test')
    .withUsername('review')
    .withUserPassword('isolated_review_only')
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
  });
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  passwordHash = await bcrypt.hash('Review123456', 4);
  pool = (await import('../../src/db')).db;
  app = (await import('../../src/core/app')).createCoreApp(new ModuleRuntime());
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
}, 30000);
async function fresh(role = 'creator', parentId: string | null = null, duty = 'all'): Promise<Actor> {
  const name = 'batch_' + ++sequence;
  const [r] = await c.query<ResultSetHeader>(
    'INSERT INTO users(username,password_hash,role,display_name,parent_id,admin_duty,is_active,must_change_pwd) VALUES(?,?,?,?,?,?,1,0)',
    [name, passwordHash, role, name, parentId, duty],
  );
  const client = 'batch-client-session-' + sequence;
  // Isolated fixture creates many sessions from one loopback address.
  const { deleteRateLimit } = await import('../../src/utils/rateLimit');
  await deleteRateLimit('login:ip:::ffff:127.0.0.1');
  await deleteRateLimit('login:ip:127.0.0.1');
  const login = await request(app)
    .post('/api/v1/core/auth/login')
    .set('X-Client-Id', client)
    .send({ username: name, password: 'Review123456' });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return {
    id: String(r.insertId),
    name,
    headers: { Authorization: 'Bearer ' + login.body.data.token, 'X-Client-Id': client },
  };
}
async function preview(a: Actor, references: string[], operation: unknown) {
  const r = await request(app)
    .post(base + '/preview')
    .set(a.headers)
    .send({ references, operation });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}
async function execute(a: Actor, r: any) {
  const result = await request(app)
    .post(base + '/' + r.id + '/execute')
    .set(a.headers)
    .send({ reviewHash: r.reviewHash });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.data;
}
async function saved(id: string) {
  const [[r]] = await c.query<RowDataPacket[]>('SELECT role,parent_id,is_active FROM users WHERE id=?', [id]);
  return r;
}

it('rejects all four endpoints for creators, leaders and finance duty, and denies another manager’s run', async () => {
  const admin = await fresh('admin'),
    other = await fresh('admin'),
    member = await fresh();
  const run = await preview(admin, ['id:' + member.id], { kind: 'active', isActive: false });
  for (const a of [await fresh(), await fresh('leader'), await fresh('admin', null, 'finance')]) {
    expect(
      (
        await request(app)
          .post(base + '/preview')
          .set(a.headers)
          .send({ references: [member.id], operation: { kind: 'active', isActive: false } })
      ).status,
    ).toBe(403);
    expect((await request(app).get(base).set(a.headers)).status).toBe(403);
    expect(
      (
        await request(app)
          .get(base + '/' + run.id)
          .set(a.headers)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(base + '/' + run.id + '/execute')
          .set(a.headers)
          .send({ reviewHash: run.reviewHash })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await request(app)
        .get(base + '/' + run.id)
        .set(other.headers)
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .post(base + '/' + run.id + '/execute')
        .set(other.headers)
        .send({ reviewHash: run.reviewHash })
    ).status,
  ).toBe(404);
  expect((await request(app).get(base)).status).toBe(401);
});
it('previews mixed references without changing accounts or sessions; executes only valid members once', async () => {
  const a = await fresh('admin'),
    l = await fresh('leader'),
    m = await fresh(),
    staff = await fresh('operator');
  const sessions = await import('../../src/auth/tokenSessions');
  const mini = await sessions.issueRefreshSession(m.id, { type: 'mini', id: 'isolated-mini-device' });
  const run = await preview(a, ['timo' + m.id.padStart(6, '0'), m.name, 'not-found', 'id:' + staff.id], {
    kind: 'team',
    parentId: l.id,
  });
  expect(run.items.map((i: any) => i.status)).toEqual(['ready', 'blocked', 'blocked', 'blocked']);
  expect((await saved(m.id)).parent_id).toBeNull();
  expect((await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM team_memberships WHERE user_id=?',[m.id]))[0][0].n).toBe(0);
  expect((await request(app).get('/api/v1/core/auth/me').set(m.headers)).status).toBe(200);
  const result = await execute(a, run);
  expect(result.status).toBe('done');
  expect(result.items[0].status).toBe('succeeded');
  expect(String((await saved(m.id)).parent_id)).toBe(l.id);
  expect(String((await c.query<RowDataPacket[]>('SELECT leader_id FROM team_memberships WHERE open_user=?',[m.id]))[0][0].leader_id)).toBe(l.id);
  expect((await request(app).get('/api/v1/core/auth/me').set(m.headers)).status).toBe(401);
  await expect(
    sessions.assertLoginSession(m.id, mini.familyId, { type: 'mini', id: 'isolated-mini-device' }),
  ).rejects.toMatchObject({ httpStatus: 401 });
  await expect(
    sessions.rotateRefreshSession(mini.refreshToken, { type: 'mini', id: 'isolated-mini-device' }),
  ).rejects.toMatchObject({ httpStatus: 401 });
  const repeat = await execute(a, run);
  expect(repeat.items).toEqual(result.items);
  const [[audit]] = await c.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM audit_logs WHERE action='user.batch_change' AND resource_id=?",
    [run.id],
  );
  expect(Number(audit.n)).toBe(1);
});
it('requires matching preview content and rechecks state before commit', async () => {
  const a = await fresh('admin'),
    m = await fresh(),
    l = await fresh('leader');
  const run = await preview(a, [m.id], { kind: 'role', role: 'leader' });
  expect(
    (
      await request(app)
        .post(base + '/' + run.id + '/execute')
        .set(a.headers)
        .send({ reviewHash: '0'.repeat(64) })
    ).status,
  ).toBe(409);
  await c.query('UPDATE users SET parent_id=? WHERE id=?', [l.id, m.id]);
  const done = await execute(a, run);
  expect(done.items[0].status).toBe('failed');
  expect(done.items[0].message).toContain('已变化');
  expect((await saved(m.id)).role).toBe('creator');
});
it('places all descendants and demotes their leader together, with inactive children included', async () => {
  const a = await fresh('admin'),
    old = await fresh('leader'),
    target = await fresh('leader'),
    child = await fresh('creator', old.id),
    disabled = await fresh('creator', old.id);
  await c.query('UPDATE users SET is_active=0 WHERE id=?', [disabled.id]);
  const run = await preview(a, [old.id], {
    kind: 'role',
    role: 'creator',
    parentId: null,
    childrenParentId: target.id,
  });
  expect(run.items[0].preview.before).toHaveLength(3);
  expect(run.items[0].status).toBe('ready');
  expect((await saved(old.id)).role).toBe('leader');
  expect(String((await saved(child.id)).parent_id)).toBe(old.id);
  expect((await execute(a, run)).items[0].status).toBe('succeeded');
  expect((await saved(old.id)).role).toBe('creator');
  expect(String((await saved(child.id)).parent_id)).toBe(target.id);
  expect(String((await saved(disabled.id)).parent_id)).toBe(target.id);
});
it('rolls back the complete dependent unit when the receiving leader becomes unavailable', async () => {
  const a = await fresh('admin'),
    old = await fresh('leader'),
    target = await fresh('leader'),
    child = await fresh('creator', old.id);
  const run = await preview(a, [old.id], { kind: 'role', role: 'creator', childrenParentId: target.id });
  await c.query('UPDATE users SET is_active=0 WHERE id=?', [target.id]);
  expect((await execute(a, run)).items[0].status).toBe('failed');
  expect((await saved(old.id)).role).toBe('leader');
  expect(String((await saved(child.id)).parent_id)).toBe(old.id);
});
it('blocks incomplete, cyclic and overlapping descendant placement in preview', async () => {
  const a = await fresh('admin'),
    l = await fresh('leader'),
    m = await fresh('creator', l.id);
  for (const [refs, op] of [
    [[l.id], { kind: 'role', role: 'creator' }],
    [[l.id], { kind: 'role', role: 'creator', childrenParentId: l.id }],
    [[l.id, m.id], { kind: 'role', role: 'creator', childrenParentId: null }],
  ] as const) {
    const run = await preview(a, [...refs], op);
    expect(run.items[0].status).toBe('blocked');
  }
});
it('blocks stale descendant lists instead of silently moving additional members', async () => {
  const a = await fresh('admin'),
    l = await fresh('leader');
  await fresh('creator', l.id);
  const run = await preview(a, [l.id], { kind: 'role', role: 'creator', childrenParentId: null });
  const late = await fresh('creator', l.id);
  expect((await execute(a, run)).items[0].status).toBe('failed');
  expect(String((await saved(late.id)).parent_id)).toBe(l.id);
});
it('adds/removes selected projects without replacing unrelated grants and preserves project owners', async () => {
  const a = await fresh('operator'),
    m = await fresh(),
    owner = await fresh();
  const [p] = await c.query<ResultSetHeader>("INSERT INTO projects(name,slug) VALUES('批量项目','batch-project')");
  const [q] = await c.query<ResultSetHeader>("INSERT INTO projects(name,slug) VALUES('原项目','existing-project')");
  await c.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES(?,?,'member'),(?,?,'owner')", [
    q.insertId,
    m.id,
    p.insertId,
    owner.id,
  ]);
  const added = await execute(
    a,
    await preview(a, [m.id], { kind: 'projects', mode: 'add', projectIds: [String(p.insertId)] }),
  );
  expect(added.items[0].status).toBe('succeeded');
  const removed = await execute(
    a,
    await preview(a, [m.id, owner.id], { kind: 'projects', mode: 'remove', projectIds: [String(p.insertId)] }),
  );
  expect(removed.items.map((i: any) => i.status)).toEqual(['succeeded', 'blocked']);
  const [[original]] = await c.query<RowDataPacket[]>(
    'SELECT left_at FROM project_members WHERE user_id=? AND project_id=?',
    [m.id, q.insertId],
  );
  expect(original.left_at).toBeNull();
});
it('resumes bounded chunks, rejects actor permission loss, and never repeats successful rows', async () => {
  const a = await fresh('admin'),
    members: Actor[] = [];
  for (let i = 0; i < 12; i++) members.push(await fresh());
  const run = await preview(
    a,
    members.map((m) => m.id),
    { kind: 'active', isActive: false },
  );
  const first = await execute(a, run);
  expect(first.status).toBe('running');
  expect(first.items.filter((i: any) => i.status === 'succeeded')).toHaveLength(10);
  const reload = await request(app)
    .get(base + '/' + run.id)
    .set(a.headers);
  expect(reload.body.data.items.filter((i: any) => i.status === 'pending')).toHaveLength(2);
  const done = await execute(a, run);
  expect(done.status).toBe('done');
  expect(done.items.every((i: any) => i.status === 'succeeded')).toBe(true);
  const m = await fresh(),
    next = await preview(a, [m.id], { kind: 'active', isActive: false });
  await c.query("UPDATE users SET admin_duty='finance' WHERE id=?", [a.id]);
  expect(
    (
      await request(app)
        .post(base + '/' + next.id + '/execute')
        .set(a.headers)
        .send({ reviewHash: next.reviewHash })
    ).status,
  ).toBe(403);
  expect((await saved(m.id)).is_active).toBe(1);
});
it('counts/directly lists all current team members without conflating invitation source', async () => {
  const a = await fresh('admin'),
    l = await fresh('leader');
  const members = [await fresh('creator', l.id), await fresh('creator', l.id)];
  await c.query('UPDATE users SET is_active=0 WHERE id=?', [members[1].id]);
  const r = await request(app).get('/api/v1/core/team/members').set(a.headers);
  expect(r.status).toBe(200);
  expect(r.body.data.find((u: any) => u.id === l.id).memberCount).toBe(2);
  expect(r.body.data.filter((u: any) => String(u.parentId) === l.id)).toHaveLength(2);
});
it('serializes concurrent confirmations and rejects excessive or management-role payloads', async () => {
  const a = await fresh('admin'),
    members = [await fresh(), await fresh(), await fresh()];
  const run = await preview(
    a,
    members.map((m) => m.id),
    { kind: 'active', isActive: false },
  );
  const results = await Promise.all([execute(a, run), execute(a, run)]);
  expect(results.every((r) => r.items.every((i: any) => i.status === 'succeeded'))).toBe(true);
  const [[audit]] = await c.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM audit_logs WHERE action='user.batch_change' AND resource_id=?",
    [run.id],
  );
  expect(Number(audit.n)).toBe(3);
  expect(
    (
      await request(app)
        .post(base + '/preview')
        .set(a.headers)
        .send({ references: [members[0].id], operation: { kind: 'role', role: 'developer' } })
    ).status,
  ).toBe(422);
  expect(
    (
      await request(app)
        .post(base + '/preview')
        .set(a.headers)
        .send({ references: Array(1001).fill(members[0].id), operation: { kind: 'active', isActive: true } })
    ).status,
  ).toBe(422);
});
it('keeps current membership when a selected member already has the requested role', async () => {
  const a = await fresh('admin'),
    l = await fresh('leader'),
    m = await fresh('creator', l.id);
  const run = await preview(a, [m.id], { kind: 'role', role: 'creator', parentId: null });
  expect(run.items[0].status).toBe('unchanged');
  await execute(a, run);
  expect(String((await saved(m.id)).parent_id)).toBe(l.id);
});
