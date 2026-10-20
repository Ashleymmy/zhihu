import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';

let container: StartedMySqlContainer, c: mysql.Connection;
let db: typeof import('../../src/db').db,
  tx: typeof import('../../src/db').withTransaction,
  rel: typeof import('../../src/core/member-relations');
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
const admin: AuthUser = { sub: '1', role: 'admin', adminDuty: 'all', username: 'user1', displayName: '管理员', parentId: null, jti: 'relations' };
const openLeader = async (userId: string) =>
  (await q('SELECT CAST(leader_id AS CHAR) leader_id,source FROM team_memberships WHERE open_user=?', [userId]))[0];

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withCommand(['--log-bin-trust-function-creators=1'])
    .withDatabase('core_relations')
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
    JWT_SECRET: 'relations_isolated_secret_over_32_characters',
  });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  // 1 管理员；2、3 团长；4 团长 2 的达人；5 由 4 邀请；6 运营；7 团长 2 直接创建
  const people: [number, string, number | null, number | null][] = [
    [1, 'admin', null, null],
    [2, 'leader', null, null],
    [3, 'leader', null, null],
    [4, 'creator', 2, null],
    [5, 'creator', 2, null],
    [6, 'operator', null, null],
    [7, 'creator', 2, 2],
  ];
  for (const [id, role, parent, createdBy] of people)
    await c.query(
      "INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,parent_id,created_by,created_at) VALUES(?,?,?,?,'all',?,?,?,'2026-08-01 10:00:00')",
      [id, 'user' + id, 'unused', role, '人员' + id, parent, createdBy],
    );
  await c.query("INSERT INTO member_invitations(id,owner_user_id,team_leader_id,token_hash,label,max_uses,used_count,expires_at,created_at) VALUES(1,4,2,REPEAT('a',64),'测试邀请',10,1,'2099-01-01 00:00:00','2026-08-02 09:00:00')");
  await c.query("INSERT INTO member_invitation_uses(user_id,invitation_id,registered_at) VALUES(5,1,'2026-08-03 12:00:00')");
  await c.query("INSERT INTO team_applications(creator_id,leader_id,status,handled_by,handled_at) VALUES(4,2,'approved',2,'2026-08-05 08:30:00')");
  ({ db, withTransaction: tx } = await import('../../src/db'));
  rel = await import('../../src/core/member-relations');
}, 90000);
afterAll(async () => {
  await db?.end();
  await c?.end();
  await container?.stop();
}, 30000);

it('回填补齐邀请关系、闭包、团队归属和角色历史，重复执行不再新增，核对通过', async () => {
  const first = await tx((conn) => rel.backfillMemberRelations(conn));
  expect(first).toEqual({ referralsFromInvitations: 1, referralsLeaderCreated: 1, referralsUntraceable: 5, closureRows: 2, memberships: 7, roleRows: 7 });
  expect(await tx((conn) => rel.backfillMemberRelations(conn))).toEqual({
    referralsFromInvitations: 0, referralsLeaderCreated: 0, referralsUntraceable: 0, closureRows: 0, memberships: 0, roleRows: 0,
  });
  const referrals = await q('SELECT user_id,CAST(inviter_id AS CHAR) inviter,channel FROM member_referrals ORDER BY user_id');
  expect(referrals.find((r) => r.user_id === 5)).toMatchObject({ inviter: '4', channel: 'creator_invite' });
  expect(referrals.find((r) => r.user_id === 7)).toMatchObject({ inviter: '2', channel: 'leader_created' });
  expect(referrals.find((r) => r.user_id === 6)).toMatchObject({ inviter: null, channel: 'organic' });
  // 达人 4 的归属从入团申请通过时算起；运营挂不到团队上
  const [member4] = await q("SELECT DATE_FORMAT(effective_from,'%Y-%m-%d %H:%i') f FROM team_memberships WHERE open_user=4");
  expect(member4?.f).toBe('2026-08-05 08:30');
  expect(await openLeader('6')).toMatchObject({ leader_id: null });
  expect((await tx((conn) => rel.checkMemberRelations(conn))).ok).toBe(true);
});

it('注册时按邀请链写闭包：直接邀请深度 1，邀请人的上级深度 2，分层人数可直接统计', async () => {
  await c.query("INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(8,'user8','unused','creator','人员8',2)");
  await tx((conn) => rel.recordRegistration(conn, { userId: 8, role: 'creator', parentId: 2, inviterId: 5, invitationId: null, channel: 'organic' }));
  const closure = await q('SELECT ancestor_id a,depth d FROM member_referral_closure WHERE descendant_id=8 ORDER BY depth');
  expect(closure).toEqual([{ a: 5, d: 1 }, { a: 4, d: 2 }]);
  const [layers] = await q('SELECT SUM(depth=1) direct,SUM(depth>=2) indirect FROM member_referral_closure WHERE ancestor_id=4');
  expect(layers).toEqual({ direct: '1', indirect: '1' });
  expect(await openLeader('8')).toMatchObject({ leader_id: '2', source: 'registration' });
  // 再调一次不会重复写邀请关系或闭包
  await tx((conn) => rel.recordRegistration(conn, { userId: 8, role: 'creator', parentId: 2, inviterId: 5, channel: 'organic' }));
  expect((await q('SELECT COUNT(*) n FROM member_referral_closure WHERE descendant_id=8'))[0]?.n).toBe(2);
});

it('转队关旧开新、按时间可查到当时的团长；连续变更不留空档；数据库拒绝两条有效归属和自己邀请自己', async () => {
  const before = (await q('SELECT NOW(3) t'))[0]?.t;
  await tx((conn) => rel.setTeamLeader(conn, { userId: 4, parentId: 3, source: 'transfer', operatorId: 1 }));
  await tx((conn) => rel.setTeamLeader(conn, { userId: 4, parentId: 2, source: 'transfer', operatorId: 1 }));
  await tx((conn) => rel.setTeamLeader(conn, { userId: 4, parentId: 2, source: 'transfer', operatorId: 1 })); // 未变化，不写
  const history = await q('SELECT CAST(leader_id AS CHAR) l,effective_from f,effective_to t FROM team_memberships WHERE user_id=4 ORDER BY id');
  expect(history.map((h) => h.l)).toEqual(['2', '3', '2']);
  const ms = (v: unknown) => new Date(v as string).getTime();
  expect(ms(history[1]?.f)).toBe(ms(history[0]?.t));
  expect(ms(history[2]?.f)).toBe(ms(history[1]?.t));
  const [atBefore] = await q('SELECT CAST(leader_id AS CHAR) l FROM team_memberships WHERE user_id=4 AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)', [before, before]);
  expect(atBefore?.l).toBe('2');
  await expect(c.query("INSERT INTO team_memberships(user_id,leader_id,source,effective_from) VALUES(4,3,'transfer',NOW(3))")).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  await expect(c.query("INSERT INTO member_referrals(user_id,inviter_id,channel,registered_at) VALUES(9999,9999,'organic',NOW(3))")).rejects.toBeTruthy();
  await expect(c.query('INSERT INTO member_referral_closure(ancestor_id,descendant_id,depth) VALUES(4,4,1)')).rejects.toBeTruthy();
});

it('审批入团申请与管理员调整团队时，同一事务写入团队归属历史', async () => {
  await c.query("INSERT INTO users(id,username,password_hash,role,display_name) VALUES(9,'user9','unused','creator','人员9')");
  await tx((conn) => rel.recordRegistration(conn, { userId: 9, role: 'creator', channel: 'organic' }));
  const [app] = await c.query<mysql.ResultSetHeader>("INSERT INTO team_applications(creator_id,leader_id,status) VALUES(9,3,'pending')");
  const team = await import('../../src/services/team.service');
  await team.reviewApplication(admin, String(app.insertId), 'approve');
  expect(await openLeader('9')).toMatchObject({ leader_id: '3', source: 'application' });
  const access = await import('../../src/services/member-access.service');
  const { ModuleRuntime } = await import('../../src/core/module-runtime');
  await access.updateMemberAccess(admin, '9', { parentId: '2' }, new ModuleRuntime([]));
  expect(await openLeader('9')).toMatchObject({ leader_id: '2', source: 'transfer' });
  expect((await tx((conn) => rel.checkMemberRelations(conn))).ok).toBe(true);
});

it('巡检发现 parent_id 与团队归属不一致只报告不修改；注销后结束归属', async () => {
  await c.query('UPDATE users SET parent_id=3 WHERE id=7');
  const report = await tx((conn) => rel.checkMemberRelations(conn));
  expect(report.ok).toBe(false);
  expect(report.mismatches).toContainEqual({ userId: '7', parentId: '3', leaderId: '2' });
  expect(await openLeader('7')).toMatchObject({ leader_id: '2' });
  await c.query('UPDATE users SET parent_id=2 WHERE id=7');
  await tx((conn) => rel.closeTeamMembership(conn, { userId: 7, reason: '账号注销' }));
  await c.query('UPDATE users SET closed_at=NOW(3),is_active=0,parent_id=NULL WHERE id=7');
  const after = await tx((conn) => rel.checkMemberRelations(conn));
  expect(after).toMatchObject({ closedButOpen: 0, missingMemberships: 0, mismatches: [], ok: true });
});
