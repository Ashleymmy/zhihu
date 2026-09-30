import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { runOpcMigrations } from '../../scripts/opcMigrations';
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn() }));
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db, app: express.Express;
const password = 'isolated_invitation_password';
let serial = 0;
const sessions: Record<string, { token: string; headers: Record<string, string> }> = {};
const headers = () => ({ 'X-Client-Id': randomUUID(), 'X-Forwarded-For': '10.2.0.' + ((++serial % 250) + 1) });
async function login(name: string) {
  const h = headers();
  const res = await request(app).post('/auth/login').set(h).send({ username: name, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (sessions[name] = { token: res.body.data.token, headers: h });
}
function call(name: string, method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  return request(app)[method](path).set(sessions[name].headers).auth(sessions[name].token, { type: 'bearer' });
}
async function invite(name = 'leader', maxUses = 20) {
  const r = await call(name, 'post', '/team/invitations').send({ label: '测试邀请', validDays: 7, maxUses });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; token: string };
}
const register = (token: string, username = 'invited_' + ++serial) =>
  request(app).post('/auth/register').set(headers()).send({ username, password, invitationToken: token });
const preview = (token: string) => request(app).post('/auth/invitation').send({ token });
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('members_test')
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
    DEV_DEMO_AUTH: '0',
    OPC_MODULES: 'zhihu',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  const hash = await bcrypt.hash(password, 4);
  for (const [i, role] of ['developer', 'admin', 'operator', 'leader', 'creator', 'leader', 'admin'].entries())
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,role_id,display_name,parent_id,admin_duty,must_change_pwd) VALUES(?,?,?,?,(SELECT id FROM roles WHERE role_key=?),?,?,?,0)',
      [
        i + 1,
        i === 5 ? 'other_leader' : i === 6 ? 'finance' : role,
        hash,
        role,
        role,
        i === 3 ? '邀请团长' : role,
        i === 4 ? 4 : null,
        i === 6 ? 'finance' : role === 'operator' ? 'operations' : 'all',
      ],
    );
  pool = (await import('../../src/db')).db;
  const { authRouter } = await import('../../src/routes/auth');
  const { teamRouter } = await import('../../src/routes/team');
  const { projectsRouter } = await import('../../src/routes/projects');
  const { errorHandler } = await import('../../src/middleware/errors');
  app = express()
    .set('trust proxy', 1)
    .use(express.json())
    .use('/auth', authRouter)
    .use('/team', teamRouter)
    .use('/projects', projectsRouter)
    .use(errorHandler);
  for (const name of ['developer', 'admin', 'operator', 'leader', 'creator', 'other_leader', 'finance'])
    await login(name);
}, 180000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

it('only authorized roles create invitations; malformed and privilege-bearing registration are rejected', async () => {
  for (const name of ['creator', 'finance'])
    expect((await call(name, 'post', '/team/invitations').send({ label: 'x' })).status).toBe(403);
  expect((await preview('invalid')).status).toBe(422);
  const i = await invite();
  expect(
    (
      await request(app)
        .post('/auth/register')
        .set(headers())
        .send({ username: 'escalation', password, invitationToken: i.token, role: 'developer' })
    ).status,
  ).toBe(422);
});
it('leader invitation records provenance and joins only the correct team, without granting project access', async () => {
  const i = await invite();
  expect((await preview(i.token)).body.data).toMatchObject({
    inviterName: '邀请团长',
    teamName: '邀请团长',
    role: 'creator',
  });
  const r = await register(i.token, 'joined_creator');
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const [[u]] = await c.query<RowDataPacket[]>('SELECT * FROM users WHERE id=?', [r.body.data.id]);
  expect(u.role).toBe('creator');
  expect(String(u.parent_id)).toBe('4');
  expect(String(u.created_by)).toBe('4');
  const [[p]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM project_members WHERE user_id=?', [u.id]);
  expect(p.n).toBe(0);
  const list = (await call('leader', 'get', '/team/members')).body.data;
  expect(list.find((m: any) => m.id === String(u.id))).toMatchObject({
    registrationSource: 'invitation',
    inviterName: '邀请团长',
    parentName: '邀请团长',
    canManage: true,
    editableRoles: ['creator'],
  });
  expect((await call('other_leader', 'get', '/team/members')).body.data.some((m: any) => m.id === String(u.id))).toBe(
    false,
  );
  expect((await call('leader', 'delete', '/team/members/' + u.id)).status).toBe(422);
});
it('staff invitation creates an independent creator and duplicate registration does not consume capacity', async () => {
  const i = await invite('operator', 2);
  expect((await register(i.token, 'creator')).status).toBe(409);
  const r = await register(i.token);
  expect(r.status).toBe(201);
  const [[u]] = await c.query<RowDataPacket[]>('SELECT role,parent_id,created_by FROM users WHERE id=?', [
    r.body.data.id,
  ]);
  expect(u.role).toBe('creator');
  expect(u.parent_id).toBeNull();
  expect(String(u.created_by)).toBe('3');
  const [[row]] = await c.query<RowDataPacket[]>('SELECT used_count,token_hash FROM member_invitations WHERE id=?', [
    i.id,
  ]);
  expect(row.used_count).toBe(1);
  expect(row.token_hash).not.toBe(i.token);
});
it('concurrent registrations cannot overdraw the final invitation slot', async () => {
  const i = await invite('leader', 1);
  const result = await Promise.all([register(i.token), register(i.token), register(i.token)]);
  expect(result.map((r) => r.status).sort()).toEqual([201, 422, 422]);
  const [[row]] = await c.query<RowDataPacket[]>('SELECT used_count FROM member_invitations WHERE id=?', [i.id]);
  expect(row.used_count).toBe(1);
  expect((await preview(i.token)).status).toBe(422);
});
it('invitation listing is private, tokens are excluded from lists, and another owner cannot revoke it', async () => {
  const i = await invite();
  expect((await call('other_leader', 'post', '/team/invitations/' + i.id + '/revoke')).status).toBe(403);
  expect((await call('developer', 'get', '/team/invitations')).body.data.some((r: any) => r.id === i.id)).toBe(false);
  const list = await call('leader', 'get', '/team/invitations');
  expect(JSON.stringify(list.body)).not.toContain(i.token);
  expect(JSON.stringify(list.body)).not.toContain('tokenHash');
  expect((await call('leader', 'post', '/team/invitations/' + i.id + '/revoke')).status).toBe(200);
  expect((await preview(i.token)).status).toBe(422);
  expect((await register(i.token)).status).toBe(422);
});

it('owner can copy the same encrypted link repeatedly; other accounts cannot read, edit, rotate or delete it', async () => {
  const i = await invite();
  for (let n=0;n<2;n++) {
    const r=await call('leader','get',`/team/invitations/${i.id}/link`);
    expect(r.status).toBe(200);expect(r.body.data.token).toBe(i.token);
    expect(r.headers['cache-control']).toBe('no-store');
  }
  const [[stored]]=await c.query<RowDataPacket[]>('SELECT token_cipher FROM member_invitations WHERE id=?',[i.id]);
  expect(stored.token_cipher).not.toContain(i.token);
  for(const actor of ['other_leader','admin','creator']) {
    expect((await call(actor,'get',`/team/invitations/${i.id}/link`)).status).toBe(403);
    expect((await call(actor,'patch',`/team/invitations/${i.id}`).send({label:'越权'})).status).toBe(403);
    expect((await call(actor,'post',`/team/invitations/${i.id}/regenerate`)).status).toBe(403);
    expect((await call(actor,'delete',`/team/invitations/${i.id}`)).status).toBe(403);
  }
});

it('editing invitation capacity and expiry keeps its link and attribution, with strict immutable owner fields', async () => {
  const i=await invite('leader',1);
  const joined=await register(i.token);
  expect(joined.status).toBe(201);
  expect((await preview(i.token)).status).toBe(422);
  expect((await call('leader','patch',`/team/invitations/${i.id}`).send({label:'新版邀请',maxUses:2,expiresAt:new Date(Date.now()+86400000).toISOString()})).status).toBe(200);
  expect((await preview(i.token)).status).toBe(200);
  expect((await register(i.token)).status).toBe(201);
  expect((await call('leader','patch',`/team/invitations/${i.id}`).send({maxUses:1})).status).toBe(422);
  expect((await call('leader','patch',`/team/invitations/${i.id}`).send({teamLeaderId:'6'})).status).toBe(422);
  expect((await call('leader','patch',`/team/invitations/${i.id}`).send({expiresAt:new Date(Date.now()-1000).toISOString()})).status).toBe(422);
  const [[u]]=await c.query<RowDataPacket[]>('SELECT parent_id FROM users WHERE id=?',[joined.body.data.id]);
  expect(String(u.parent_id)).toBe('4');
});

it('disable, re-enable, regenerate and delete links invalidate only future registration, retaining provenance', async () => {
  const i=await invite();
  const joined=await register(i.token);
  expect((await call('leader','patch',`/team/invitations/${i.id}`).send({enabled:false})).status).toBe(200);
  expect((await register(i.token)).status).toBe(422);
  expect((await call('leader','patch',`/team/invitations/${i.id}`).send({enabled:true})).status).toBe(200);
  const rotated=await call('leader','post',`/team/invitations/${i.id}/regenerate`);
  expect(rotated.status).toBe(200);expect(rotated.body.data.token).not.toBe(i.token);
  expect((await preview(i.token)).status).toBe(422);
  expect((await preview(rotated.body.data.token)).status).toBe(200);
  expect((await call('leader','delete',`/team/invitations/${i.id}`)).status).toBe(200);
  expect((await preview(rotated.body.data.token)).status).toBe(422);
  expect((await register(rotated.body.data.token)).status).toBe(422);
  expect((await call('leader','get','/team/invitations')).body.data.some((r:any)=>r.id===i.id)).toBe(false);
  expect((await call('leader','patch',`/team/invitations/${i.id}`).send({enabled:true})).status).toBe(403);
  const [[history]]=await c.query<RowDataPacket[]>('SELECT u.parent_id,iu.invitation_id FROM users u JOIN member_invitation_uses iu ON iu.user_id=u.id WHERE u.id=?',[joined.body.data.id]);
  expect(String(history.parent_id)).toBe('4');expect(String(history.invitation_id)).toBe(i.id);
});

it('legacy hash-only invitations keep working and are rotated only on explicit regeneration', async () => {
  const i=await invite();
  await c.query('UPDATE member_invitations SET token_cipher=NULL WHERE id=?',[i.id]);
  expect((await preview(i.token)).status).toBe(200);
  expect((await call('leader','get',`/team/invitations/${i.id}/link`)).status).toBe(409);
  const rotated=await call('leader','post',`/team/invitations/${i.id}/regenerate`);
  expect((await preview(i.token)).status).toBe(422);
  expect((await preview(rotated.body.data.token)).status).toBe(200);
});
it('expired invitations and disabled or changed team owners cannot enroll users', async () => {
  const i = await invite();
  await c.query('UPDATE member_invitations SET expires_at=TIMESTAMPADD(SECOND,-1,NOW(3)) WHERE id=?', [i.id]);
  expect((await register(i.token)).status).toBe(422);
  const j = await invite();
  await c.query('UPDATE users SET is_active=0 WHERE id=4');
  expect((await preview(j.token)).status).toBe(422);
  expect((await register(j.token)).status).toBe(422);
  await c.query("UPDATE users SET is_active=1,role='creator' WHERE id=4");
  expect((await register(j.token)).status).toBe(422);
  await c.query("UPDATE users SET role='leader' WHERE id=4");
});
it('member editing enforces hierarchy, own-team scope, duty restrictions and creator management denial', async () => {
  for (const [actor, id, patch] of [
    ['admin', '1', { displayName: 'deny' }],
    ['admin', '2', { isActive: false }],
    ['operator', '2', { displayName: 'deny' }],
    ['operator', '5', { role: 'admin' }],
    ['leader', '5', { role: 'leader' }],
    ['other_leader', '5', { displayName: 'deny' }],
    ['creator', '5', { role: 'developer' }],
    ['finance', '5', { isActive: false }],
    ['admin', '5', { adminDuty: 'all' }],
  ] as const)
    expect((await call(actor, 'patch', '/team/members/' + id + '/access').send(patch)).status).toBe(403);
  expect((await call('leader', 'patch', '/team/members/5/access').send({ displayName: '更新达人' })).status).toBe(200);
  expect((await call('creator', 'get', '/projects/1/members')).status).toBe(403);
});
it('role, duty, status and team changes revoke existing sessions; profile-only edits preserve them', async () => {
  expect((await call('creator', 'get', '/auth/me')).status).toBe(200);
  expect((await call('developer', 'patch', '/team/members/5/access').send({ parentId: '6' })).status).toBe(200);
  expect((await call('creator', 'get', '/auth/me')).status).toBe(401);
  await login('creator');
  expect((await call('developer', 'patch', '/team/members/5/access').send({ role: 'operator' })).status).toBe(200);
  expect((await call('creator', 'get', '/auth/me')).status).toBe(401);
  await login('creator');
  expect((await call('developer', 'patch', '/team/members/5/access').send({ isActive: false })).status).toBe(200);
  expect((await call('creator', 'get', '/auth/me')).status).toBe(401);
  expect(
    (await call('developer', 'patch', '/team/members/5/access').send({ isActive: true, role: 'creator' })).status,
  ).toBe(200);
  await login('creator');
  const [[s]] = await c.query<RowDataPacket[]>(
    'SELECT COUNT(*) n FROM token_sessions WHERE user_id=5 AND revoked_at IS NULL',
  );
  expect(s.n).toBe(1);
  expect((await call('developer', 'patch', '/team/members/7/access').send({ adminDuty: 'operations' })).status).toBe(
    200,
  );
  expect((await call('finance', 'get', '/auth/me')).status).toBe(401);
});
it('team leaders with children cannot be reclassified and creators cannot join invalid teams', async () => {
  expect((await call('developer', 'patch', '/team/members/4/access').send({ role: 'creator' })).status).toBe(409);
  expect((await call('developer', 'patch', '/team/members/5/access').send({ parentId: '2' })).status).toBe(422);
  expect((await call('developer', 'delete', '/team/members/4')).status).toBe(422);
});

it('member editing assigns multiple projects atomically and revokes old sessions', async () => {
  await c.query(
    "INSERT INTO projects(id,name,slug,is_enabled) VALUES(901,'项目甲','member-project-a',1),(902,'项目乙','member-project-b',1),(903,'停用项目','member-project-off',0)",
  );
  const r = await call('admin', 'patch', '/team/members/5/access').send({
    displayName: '项目达人',
    projectIds: ['901', '902'],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await call('creator', 'get', '/auth/me')).status).toBe(401);
  await login('creator');
  expect((await call('creator', 'get', '/projects')).body.data.map((p: any) => p.id).sort()).toEqual(['901', '902']);
  const member = (await call('admin', 'get', '/team/members')).body.data.find((m: any) => m.id === '5');
  expect(member).toMatchObject({ displayName: '项目达人', canAssignProjects: true });
  expect(member.projects).toEqual([
    { id: '901', name: '项目甲', isEnabled: true, memberRole: 'member' },
    { id: '902', name: '项目乙', isEnabled: true, memberRole: 'member' },
  ]);
  for (const ids of [
    ['901', '903'],
    ['901', '999999'],
    ['901', '901'],
  ]) {
    expect(
      (await call('admin', 'patch', '/team/members/5/access').send({ displayName: '应回滚', projectIds: ids })).status,
    ).toBe(422);
    const [[u]] = await c.query<RowDataPacket[]>('SELECT display_name FROM users WHERE id=5');
    expect(u.display_name).toBe('项目达人');
    expect((await call('creator', 'get', '/auth/me')).status).toBe(200);
    expect((await call('creator', 'get', '/projects')).body.data).toHaveLength(2);
  }
});

it('scoped project assignment never grants project configuration or role escalation', async () => {
  // Role changes clear team membership; explicitly attach the creator for this scope check.
  expect((await call('admin', 'patch', '/team/members/5/access').send({ parentId: '6' })).status).toBe(200);
  await login('creator');
  for (const actor of ['operator', 'other_leader']) {
    expect((await call(actor, 'get', '/team/members')).body.data.find((m: any) => m.id === '5').canAssignProjects).toBe(
      true,
    );
    expect((await call(actor, 'post', '/projects').send({ name: '越权项目', slug: 'unauthorized' })).status).toBe(403);
  }
  expect(
    (await call('other_leader', 'patch', '/team/members/5/access').send({ role: 'leader', projectIds: ['901'] })).status,
  ).toBe(403);
  expect((await call('other_leader', 'patch', '/team/members/5/access').send({ projectIds: ['999999'] })).status).toBe(403);
  expect((await call('operator', 'patch', '/team/members/5/access').send({ role: 'admin', projectIds: ['901'] })).status).toBe(403);
  const [[u]] = await c.query<RowDataPacket[]>('SELECT role,parent_id FROM users WHERE id=5');
  expect(u.role).toBe('creator');
  expect(String(u.parent_id)).toBe('6');
  expect((await call('developer', 'patch', '/team/members/3/access').send({ projectIds: ['901'] })).status).toBe(422);
});

it('unchanged project roles are retained, new access is ordinary membership, and owners cannot be removed here', async () => {
  await c.query("UPDATE project_members SET member_role='admin' WHERE project_id=901 AND user_id=5");
  expect((await call('admin', 'patch', '/team/members/5/access').send({ projectIds: ['902', '901'] })).status).toBe(
    200,
  );
  expect((await call('creator', 'get', '/auth/me')).status).toBe(200);
  const [[preserved]] = await c.query<RowDataPacket[]>(
    'SELECT member_role FROM project_members WHERE project_id=901 AND user_id=5',
  );
  expect(preserved.member_role).toBe('admin');
  expect((await call('admin', 'patch', '/team/members/5/access').send({ projectIds: ['902'] })).status).toBe(200);
  expect((await call('creator', 'get', '/auth/me')).status).toBe(401);
  await login('creator');
  expect((await call('creator', 'get', '/projects')).body.data.map((p: any) => p.id)).toEqual(['902']);
  expect((await call('admin', 'patch', '/team/members/5/access').send({ projectIds: ['901', '902'] })).status).toBe(
    200,
  );
  const [[rejoined]] = await c.query<RowDataPacket[]>(
    'SELECT member_role,left_at FROM project_members WHERE project_id=901 AND user_id=5',
  );
  expect(rejoined.member_role).toBe('member');
  expect(rejoined.left_at).toBeNull();
  await c.query("UPDATE project_members SET member_role='owner' WHERE project_id=902 AND user_id=5");
  expect((await call('admin', 'patch', '/team/members/5/access').send({ projectIds: [] })).status).toBe(409);
  const [[stillThere]] = await c.query<RowDataPacket[]>(
    'SELECT COUNT(*) n FROM project_members WHERE user_id=5 AND left_at IS NULL',
  );
  expect(stillThere.n).toBe(2);
});

it('invited creators see the real team and invitation source; platform invitations remain free to join a team', async () => {
  for (const owner of ['leader', 'operator']) {
    const link = await invite(owner);
    const name = 'affiliation_' + owner;
    const registered = await register(link.token, name);
    expect(registered.status).toBe(201);
    await login(name);
    const response = await call(name, 'get', '/team/affiliation');
    expect(response.status).toBe(200);
    expect(response.body.data.inviter).toMatchObject({ role: owner, name: owner === 'leader' ? '邀请团长' : 'operator' });
    if (owner === 'leader') {
      expect(response.body.data.team).toMatchObject({ leaderId: '4', leaderName: '邀请团长' });
      expect((await call(name, 'post', '/team/applications').send({ leaderUsername: 'other_leader' })).status).toBe(422);
    } else {
      expect(response.body.data.team).toBeNull();
      expect((await call(name, 'get', '/team/my')).body.data).toBeNull();
      expect((await call(name, 'post', '/team/applications').send({ leaderUsername: 'other_leader' })).status).toBe(201);
    }
    expect((await call(owner, 'delete', '/team/invitations/' + link.id)).status).toBe(200);
    expect((await call(name, 'get', '/team/affiliation')).body.data).toEqual(response.body.data);
  }
});

it('leaders assign their active projects to invited creators, preserving inaccessible grants and revoking stale sessions', async () => {
  const i = await invite();
  const r = await register(i.token, 'scoped_creator');
  expect(r.status).toBe(201);
  const id = String(r.body.data.id);
  await login('scoped_creator');
  await c.query("INSERT INTO projects(id,name,slug,is_enabled) VALUES(910,'团长可分配项目','leader-scope',1),(911,'其他项目','outside-scope',1),(912,'已离开项目','left-scope',1),(913,'停用项目','disabled-scope',0)");
  await c.query("INSERT INTO project_members(project_id,user_id,left_at) VALUES(910,4,NULL),(912,4,NOW()),(913,4,NULL)");
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(911,?)', [id]);
  const member = (await call('leader', 'get', '/team/members')).body.data.find((m: any) => m.id === id);
  expect(member.canAssignProjects).toBe(true);
  expect((await call('leader', 'patch', `/team/members/${id}/access`).send({ projectIds: ['910'] })).status).toBe(200);
  expect((await call('scoped_creator', 'get', '/auth/me')).status).toBe(401);
  await login('scoped_creator');
  expect((await call('scoped_creator', 'get', '/projects')).body.data.map((p: any) => p.id)).toEqual(['910','911']);
  for (const outside of ['912','913','999999']) {
    const response = await call('leader', 'patch', `/team/members/${id}/access`).send({ projectIds: ['910',outside], displayName: 'must rollback' });
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    const [[member]] = await c.query<RowDataPacket[]>('SELECT display_name FROM users WHERE id=?', [id]);
    expect(member.display_name).not.toBe('must rollback');
  }
  expect((await call('other_leader', 'patch', `/team/members/${id}/access`).send({ projectIds: ['910'] })).status).toBe(403);
  expect((await call('leader', 'patch', '/team/members/4/access').send({ projectIds: ['910'] })).status).toBe(403);
  expect((await call('leader', 'patch', `/team/members/${id}/access`).send({ projectIds: [] })).status).toBe(200);
  await login('scoped_creator');
  expect((await call('scoped_creator', 'get', '/projects')).body.data.map((p: any) => p.id)).toEqual(['911']);
  // Revalidate scope at save time, even when the dialog opened before the leader left.
  await c.query('UPDATE project_members SET left_at=NOW() WHERE user_id=4 AND project_id=910');
  expect((await call('leader', 'patch', `/team/members/${id}/access`).send({ projectIds: ['910'] })).status).toBe(403);
  await c.query('UPDATE project_members SET left_at=NULL WHERE user_id=4 AND project_id=910');
  await c.query('UPDATE projects SET is_enabled=0 WHERE id=910');
  expect((await call('leader', 'patch', `/team/members/${id}/access`).send({ projectIds: ['910'] })).status).toBe(403);
  await c.query('UPDATE projects SET is_enabled=1 WHERE id=910');
});

it('operator can allocate business projects to platform-invited creators without changing attribution', async () => {
  const link = await invite('operator');
  const r = await register(link.token, 'platform_creator');
  expect(r.status).toBe(201);
  const id = String(r.body.data.id);
  expect((await call('operator','get','/team/members')).body.data.find((m: any) => m.id === id).canAssignProjects).toBe(true);
  const response = await call('operator','patch',`/team/members/${id}/access`).send({projectIds:['910','911']});
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  await login('platform_creator');
  expect((await call('platform_creator','get','/projects')).body.data.map((p: any) => p.id)).toEqual(['910','911']);
  const [[member]] = await c.query<RowDataPacket[]>('SELECT parent_id,created_by FROM users WHERE id=?',[id]);
  expect(member.parent_id).toBeNull();expect(String(member.created_by)).toBe('3');
  expect((await call('leader','patch',`/team/members/${id}/access`).send({projectIds:['910']})).status).toBe(403);
});

it('scoped managers cannot strip project administration and legacy staff parents are not shown as leaders', async () => {
  const [[u]] = await c.query<RowDataPacket[]>("SELECT id FROM users WHERE username='scoped_creator'");
  for (const memberRole of ['owner','admin']) {
    await c.query('INSERT INTO project_members(project_id,user_id,member_role) VALUES(910,?,?) ON DUPLICATE KEY UPDATE member_role=VALUES(member_role),left_at=NULL',[u.id,memberRole]);
    for (const actor of ['leader','operator']) {
      expect((await call(actor,'patch',`/team/members/${u.id}/access`).send({projectIds:['910']})).status).toBe(200);
      expect((await call(actor,'patch',`/team/members/${u.id}/access`).send({projectIds:[]})).status).toBe(memberRole==='owner'?409:403);
    }
    const [[kept]] = await c.query<RowDataPacket[]>('SELECT member_role,left_at FROM project_members WHERE project_id=910 AND user_id=?',[u.id]);
    expect(kept.member_role).toBe(memberRole);expect(kept.left_at).toBeNull();
  }
  await c.query("UPDATE users SET parent_id=3 WHERE username='platform_creator'");
  expect((await call('platform_creator','get','/team/my')).body.data).toBeNull();
  expect((await call('platform_creator','get','/team/affiliation')).body.data.team).toBeNull();
});
