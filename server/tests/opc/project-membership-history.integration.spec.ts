import { beforeAll, afterAll, it, expect } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { Router, type Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { ModuleRuntime } from '../../src/core/module-runtime';
import type { AuthUser } from '../../src/types';
import type { MemberHistoryChange, ModuleManifest } from '../../src/core/contracts';
import { AppError } from '../../src/middleware/errors';

let container: StartedMySqlContainer, c: mysql.Connection, app: Express, pool: typeof import('../../src/db').db;
let tx: typeof import('../../src/db').withTransaction, history: typeof import('../../src/core/member-history');
let projects: typeof import('../../src/services/projectMembers.service'),
  onboard: typeof import('../../src/services/member-onboarding.service');
const runtime = new ModuleRuntime(),
  headers: Record<string, Record<string, string>> = {};
const actor = (sub: string, role: AuthUser['role'] = 'admin', adminDuty: AuthUser['adminDuty'] = 'all'): AuthUser => ({
  sub,
  role,
  adminDuty,
  username: 'history' + sub,
  displayName: '人员' + sub,
  parentId: null,
  jti: crypto.randomUUID(),
});
const admin = actor('1'),
  ops = actor('2', 'admin', 'operations'),
  creator = actor('3', 'creator'),
  leader = actor('4', 'leader'),
  finance = actor('5', 'admin', 'finance'),
  developer = actor('6', 'developer');
const q = async (sql: string, args: unknown[] = []) => (await c.query<RowDataPacket[]>(sql, args))[0];
const route = (id = '3') => `/api/v1/core/relations/members/${id}/history-evidence`;
const read = (u = ops, id = '3', query: Record<string, string> = { projectId: '1', at: '2026-09-01' }) =>
  request(app).get(route(id)).set(headers[u.sub]).query(query);
const input = (overrides: Record<string, unknown> = {}) => ({
  projectId: '1',
  effectiveFrom: '2026-09-01',
  effectiveTo: '2026-09-02',
  timePrecision: 'date',
  participation: true,
  historicalRole: 'creator',
  leaderId: null,
  sourceKind: 'operator_confirmation',
  sourceRef: '签字项目名单-九月',
  sourceSummary: '已核对原始参加名单及当时团队与角色',
  confirmed: true,
  expectedVersion: 0,
  requestKey: crypto.randomUUID(),
  ...overrides,
});
const save = (body: object, u = ops, id = '3') => request(app).post(route(id)).set(headers[u.sub]).send(body);
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('project_history_test')
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
  });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []);
  await runOpcMigrations(target, []);
  c = await mysql.createConnection({ ...target, multipleStatements: true });
  for (const u of [admin, ops, creator, leader, finance, developer])
    await c.query(
      "INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,created_at) VALUES(?,?,'unused',?,?,?,'2020-01-01')",
      [u.sub, u.username, u.role, u.adminDuty, u.displayName],
    );
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'历史项目','zhihu'),(2,'其他项目','other')");
  await c.query(
    "INSERT INTO project_members(project_id,user_id,joined_at) VALUES(1,3,'2026-10-01'),(1,4,'2026-10-01')",
  );
  const migration = await readFile('schema/extensions/026_project_membership_history.sql', 'utf8');
  await c.query(migration);
  await c.query(migration);
  ({ db: pool, withTransaction: tx } = await import('../../src/db'));
  history = await import('../../src/core/member-history');
  projects = await import('../../src/services/projectMembers.service');
  onboard = await import('../../src/services/member-onboarding.service');
  app = (await import('../../src/core/app')).createCoreApp(runtime);
  const { signToken } = await import('../../src/auth/jwt'),
    { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  for (const u of [admin, ops, creator, leader, finance, developer]) {
    const client = 'history-client-' + u.sub,
      session = await issueRefreshSession(u.sub, { type: 'web', id: client });
    headers[u.sub] = {
      'X-Client-Id': client,
      Authorization: 'Bearer ' + (await signToken({ ...u, id: u.sub, sessionId: session.familyId })),
    };
  }
}, 90000);
afterAll(async () => {
  await pool?.end();
  await c?.end();
  await container?.stop();
}, 30000);

it('fresh and repeated upgrade preserves only the recorded latest join, never user creation or earlier gaps', async () => {
  const rows = await q(
    "SELECT user_id,DATE_FORMAT(effective_from,'%Y-%m-%d') start,prior_history_unknown FROM project_membership_history ORDER BY user_id",
  );
  expect(rows).toEqual([
    { user_id: 3, start: '2026-10-01', prior_history_unknown: 1 },
    { user_id: 4, start: '2026-10-01', prior_history_unknown: 1 },
  ]);
  const before = await tx((c) => history.resolveMemberHistory(c, '3', '1', { at: '2026-09-01' }));
  expect(before.projectParticipation.status).toBe('unknown');
  const known = await tx((c) => history.resolveMemberHistory(c, '3', '1', { at: '2026-10-01' }));
  expect(known.projectParticipation.value).toBe(true);
  expect(known.role.status).toBe('unknown');
});

it('real GET and POST enforce current duties, role hierarchy and member-project scope with valid sessions', async () => {
  expect((await request(app).get(route()).query({ projectId: '1', at: '2026-09-01' })).status).toBe(401);
  expect((await request(app).post(route()).send(input())).status).toBe(401);
  for (const u of [finance, creator, leader]) {
    expect((await read(u)).status).toBe(403);
    expect((await save(input(), u)).status).toBe(403);
  }
  expect((await read(ops, '6')).status).toBe(403);
  expect((await save(input(), ops, '6')).status).toBe(403);
  expect((await read(ops, '3', { projectId: '2', at: '2026-09-01' })).status).toBe(403);
  expect((await save(input({ projectId: '2' }))).status).toBe(403);
  await c.query("UPDATE users SET admin_duty='finance' WHERE id=2");
  expect((await read()).status).toBe(403);
  expect((await save(input())).status).toBe(403);
  await c.query("UPDATE users SET admin_duty='operations' WHERE id=2");
  expect((await read()).status).toBe(200);
});

let evidenceId = '';
it('explicit human confirmation fixes a known range, persists provenance, and identical concurrent retries return one record', async () => {
  const body = input(),
    replies = await Promise.all([save(body), save(body)]);
  for (const response of replies) expect(response.status, response.text).toBe(200);
  expect(replies[0].body.data).toEqual(replies[1].body.data);
  evidenceId = replies[0].body.data.evidenceId;
  expect(replies[0].body.data).toMatchObject({
    status: 'verified',
    version: 1,
    refreshStatus: { status: 'unchanged' },
  });
  const result = (await read()).body.data;
  expect(result.status).toBe('matched');
  expect(result.projectParticipation.value).toBe(true);
  expect(result.team.value).toBeNull();
  expect(result.role.value).toBe('creator');
  expect(JSON.stringify(result)).not.toMatch(/amount|unitPrice|billable/);
  const [saved] = await q('SELECT source_snapshot,actor_id,source_ref FROM member_history_evidence WHERE id=?', [
    evidenceId,
  ]);
  expect(saved.actor_id).toBe(2);
  expect(saved.source_snapshot.previous.status).toBe('unknown');
  expect((await save({ ...body, sourceSummary: '请求内容已改变' })).status).toBe(409);
  expect((await save(input({ effectiveFrom: '2026-09-03' }))).status).toBe(409);
  expect((await read(ops, '3', { projectId: '1', at: '2026-09-02' })).body.data.status).toBe('unknown');
  await c.query('DELETE FROM audit_logs');
  expect((await read()).body.data.status).toBe('matched');
});

it('unverified description remains pending; trusted references must match subject, range and fields', async () => {
  const pending = await save(
    input({
      expectedVersion: 1,
      sourceKind: 'description',
      confirmed: false,
      effectiveFrom: '2026-09-02',
      effectiveTo: undefined,
    }),
  );
  expect(pending.status, pending.text).toBe(200);
  expect(pending.body.data.status).toBe('pending');
  expect((await read(ops, '3', { projectId: '1', at: '2026-09-02' })).body.data.status).toBe('unknown');
  const [other] = await q('SELECT id FROM project_membership_history WHERE user_id=4');
  expect(
    (
      await save(
        input({
          sourceKind: 'project_membership',
          sourceRef: String(other.id),
          effectiveFrom: '2026-10-01',
          effectiveTo: '2026-10-02',
          historicalRole: undefined,
          leaderId: undefined,
          expectedVersion: 2,
        }),
      )
    ).status,
  ).toBe(403);
  const [own] = await q('SELECT id FROM project_membership_history WHERE user_id=3');
  const trusted = await save(
    input({
      sourceKind: 'project_membership',
      sourceRef: String(own.id),
      effectiveFrom: '2026-10-01',
      effectiveTo: '2026-10-02',
      historicalRole: undefined,
      leaderId: undefined,
      expectedVersion: 2,
    }),
  );
  expect(trusted.status, trusted.text).toBe(200);
  expect(
    (
      await save(
        input({
          sourceKind: 'operator_confirmation',
          participation: false,
          effectiveFrom: '2026-10-01',
          effectiveTo: '2026-10-02',
          expectedVersion: 3,
        }),
      )
    ).status,
  ).toBe(409);
});

it('superseding evidence is append-only, rejects stale versions, and preserves conflicting source details', async () => {
  const conflict = await save(input({ expectedVersion: 3, leaderId: '4' }));
  expect(conflict.status).toBe(409);
  expect(conflict.body.history.sources.length).toBeGreaterThan(0);
  expect(conflict.body.proposed.leaderId).toBe('4');
  const correction = await save(input({ expectedVersion: 3, supersedesId: evidenceId, leaderId: '4' }));
  expect(correction.status, correction.text).toBe(200);
  expect((await read()).body.data.team.value).toBe('4');
  expect(await q('SELECT id FROM member_history_evidence WHERE id=?', [evidenceId])).toHaveLength(1);
  expect((await save(input({ expectedVersion: 4, supersedesId: evidenceId }))).status).toBe(409);
});

it('date queries expose same-day team and role ambiguity while timestamps use half-open intervals', async () => {
  await c.query(
    "INSERT INTO team_memberships(user_id,leader_id,source,effective_from,effective_to) VALUES(3,NULL,'registration','2026-10-01','2026-10-15 12:00:00'),(3,4,'transfer','2026-10-15 12:00:00',NULL)",
  );
  await c.query(
    "INSERT INTO member_role_history(user_id,to_role,reason,effective_at) VALUES(3,'creator','registration','2026-10-01'),(3,'leader','promotion','2026-10-15 15:00:00')",
  );
  const date = await tx((c) => history.resolveMemberHistory(c, '3', '1', { at: '2026-10-15' }));
  expect(date.status).toBe('conflict');
  expect(date.team.status).toBe('conflict');
  expect(date.role.status).toBe('conflict');
  const before = await tx((c) => history.resolveMemberHistory(c, '3', '1', { at: '2026-10-15T11:59:59+08:00' }));
  expect(before.team.value).toBeNull();
  expect(before.role.value).toBe('creator');
  const after = await tx((c) => history.resolveMemberHistory(c, '3', '1', { at: '2026-10-15T15:00:00+08:00' }));
  expect(after.team.value).toBe('4');
  expect(after.role.value).toBe('leader');
  expect(
    (await save(input({ expectedVersion: 4, effectiveFrom: '2026-10-15', effectiveTo: '2026-10-16' }))).status,
  ).toBe(409);
  expect((await save(input({ expectedVersion: 4, effectiveFrom: '2026-02-30', effectiveTo: undefined }))).status).toBe(
    422,
  );
});

it('project management join, exit and rejoin retain distinct intervals and survive audit cleanup', async () => {
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name) VALUES(10,'history10','unused','creator','往返成员')",
  );
  await projects.addProjectMember(admin, '1', { userId: '10' });
  await projects.removeProjectMember(admin, '1', '10');
  await projects.addProjectMember(admin, '1', { userId: '10' });
  const periods = await q(
    'SELECT effective_from,effective_to,source_kind FROM project_membership_history WHERE user_id=10 ORDER BY id',
  );
  expect(periods).toHaveLength(2);
  expect(periods[0].effective_to).not.toBeNull();
  expect(periods[1].effective_to).toBeNull();
  await c.query('DELETE FROM audit_logs');
  expect(await q('SELECT id FROM project_membership_history WHERE user_id=10')).toHaveLength(2);
  await expect(projects.addProjectMember(admin, '1', { userId: '10' })).rejects.toMatchObject({ httpStatus: 409 });
  expect(await q('SELECT id FROM project_membership_history WHERE user_id=10')).toHaveLength(2);
});

it('onboarding is idempotent and rolled-back previews never leave participation history', async () => {
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name) VALUES(11,'history11','unused','creator','新成员'),(12,'history12','unused','creator','预览成员')",
  );
  await tx((c) => onboard.openMemberProjects(c, '11', 'creator', null, '1'));
  await tx((c) => onboard.openMemberProjects(c, '11', 'creator', null, '1'));
  expect(await q('SELECT id FROM project_membership_history WHERE user_id=11')).toHaveLength(1);
  await expect(
    tx(async (c) => {
      await onboard.openMemberProjects(c, '12', 'creator', null, '1');
      throw Error('preview rollback');
    }),
  ).rejects.toThrow('preview rollback');
  expect(await q('SELECT id FROM project_membership_history WHERE user_id=12')).toHaveLength(0);
  expect(await q('SELECT id FROM project_members WHERE user_id=12')).toHaveLength(0);
});

it('actual registration, invitation acceptance, managed creation and promotion entry points record project history', async () => {
  const auth = await import('../../src/services/auth.service'),
    invitations = await import('../../src/services/invitations.service'),
    team = await import('../../src/services/team.service');
  await projects.addProjectMember(admin, '2', { userId: '4' });
  const normal = await auth.register(
    { username: 'history-register', password: 'Review123456!' },
    undefined,
    undefined,
    'history-register',
  );
  expect(
    (await q('SELECT project_id,source_kind FROM project_membership_history WHERE user_id=?', [normal.id])).map((r) => [
      r.project_id,
      r.source_kind,
    ]),
  ).toEqual([[1, 'onboarding']]);
  const invite = await invitations.createInvitation(leader, { label: '履历入口测试', validDays: 1, maxUses: 10 });
  const invited = await auth.register(
    { username: 'history-invited', password: 'Review123456!', invitationToken: invite.token },
    undefined,
    undefined,
    'history-invited',
  );
  expect(await q('SELECT id FROM project_membership_history WHERE user_id=?', [invited.id])).toHaveLength(2);
  await invitations.acceptInvitation(actor('12', 'creator'), invite.token);
  await invitations.acceptInvitation(actor('12', 'creator'), invite.token);
  expect(await q('SELECT id FROM project_membership_history WHERE user_id=12')).toHaveLength(2);
  const created = await team.createMember(leader, { username: 'history-created', displayName: '团长新建成员' });
  expect(await q('SELECT id FROM project_membership_history WHERE user_id=?', [created.id])).toHaveLength(2);
  const [nominee] = await c.query<mysql.ResultSetHeader>(
    "INSERT INTO users(username,password_hash,role,display_name) VALUES('history-nominee','unused','creator','待晋升成员')",
  );
  const [follower] = await c.query<mysql.ResultSetHeader>(
    "INSERT INTO users(username,password_hash,role,display_name) VALUES('history-follower','unused','creator','跟随成员')",
  );
  const relations = await import('../../src/core/member-relations');
  await tx((c) =>
    relations.recordRegistration(c, {
      userId: String(follower.insertId),
      role: 'creator',
      inviterId: String(nominee.insertId),
      channel: 'organic',
    }),
  );
  const promotion = await import('../../src/core/member-promotions'),
    proposal = await promotion.nominate(ops, { userId: String(nominee.insertId), note: '核对实际晋升入口' });
  await promotion.approve(admin, proposal.id, { follow: [String(follower.insertId)] }, runtime);
  for (const memberId of [nominee.insertId, follower.insertId])
    expect(
      await q(
        "SELECT id FROM project_membership_history WHERE user_id=? AND project_id=1 AND source_kind='onboarding'",
        [memberId],
      ),
    ).toHaveLength(1);
});

it('normal project and role changes do not repair unknown earlier history or invent confirmed evidence', async () => {
  const [created] = await c.query<mysql.ResultSetHeader>(
    "INSERT INTO users(username,password_hash,role,display_name) VALUES('history-causality','unused','creator','实际变更成员')",
  );
  const memberId = String(created.insertId);
  const previousDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
    new Date(Date.now() - 86400000),
  );
  const historical = () => tx((c) => history.resolveMemberHistory(c, memberId, '1', { at: previousDay }));
  expect((await historical()).status).toBe('unknown');
  await projects.addProjectMember(admin, '1', { userId: memberId });
  await projects.removeProjectMember(admin, '1', memberId);
  await projects.addProjectMember(admin, '1', { userId: memberId });
  expect((await historical()).projectParticipation.status).toBe('unknown');
  const changes = await import('../../src/services/member-changes.service');
  const preview = await changes.previewMemberChanges(ops, [memberId], { kind: 'role', role: 'leader' }, runtime);
  expect(preview.items[0].status).toBe('ready');
  const changed = await changes.executeMemberChanges(ops, preview.id, preview.reviewHash, runtime);
  expect(changed.items[0].status).toBe('succeeded');
  const after = await historical();
  expect(after.role.status).toBe('unknown');
  expect(after.team.status).toBe('unknown');
  expect(after.projectParticipation.status).toBe('unknown');
  expect(await q('SELECT id FROM member_history_evidence WHERE user_id=?', [memberId])).toHaveLength(0);
  expect(await q('SELECT id FROM project_membership_history WHERE user_id=?', [memberId])).toHaveLength(2);
});

let callbackFails = false,
  seen: MemberHistoryChange[] = [];
it('module notification validates context and rolls evidence, versions and module writes back together', async () => {
  const manifest: ModuleManifest = {
    id: 'history-test',
    name: '历史验证',
    version: '1',
    contractVersion: 2,
    roles: ['admin'],
    capabilities: [],
    permissions: {},
    entryPath: '/history-test',
  };
  runtime.register({
    manifest,
    router: Router(),
    accountLifecycle: {
      closureBlockers: async () => [],
      erasePersonalData: async () => {},
      async memberHistoryChanged(conn, user, change) {
        if (
          change.context &&
          (change.context.sourceKind !== 'test_row' ||
            change.context.sourceId !== '15' ||
            change.context.sourceVersion !== '7')
        )
          throw new AppError(409, 40900, '原资料已变化，请刷新后重新核对');
        expect(user.adminDuty).toBe('operations');
        seen.push(change);
        await conn.query('INSERT INTO history_callback_records(evidence_id) VALUES(?)', [change.evidenceId]);
        if (callbackFails) throw Error('isolated callback failure');
        return { status: 'refreshed', recalculated: 2, resumed: change.context ? 1 : 0 };
      },
    },
  });
  await c.query(
    "INSERT INTO module_installations(module_id,version) VALUES('history-test','1');INSERT INTO integration_accounts(id,module_id,account_key,name) VALUES(1,'history-test','one','来源');INSERT INTO project_integrations(project_id,account_id) VALUES(1,1);CREATE TABLE history_callback_records(evidence_id BIGINT)",
  );
  const context = {
    moduleId: 'history-test',
    accountId: '1',
    sourceKind: 'test_row',
    sourceId: '15',
    sourceVersion: '7',
    operation: 'refresh_unconfirmed',
  };
  const body = input({ expectedVersion: 4, effectiveFrom: '2026-09-04', effectiveTo: '2026-09-05', context });
  callbackFails = true;
  const failed = await save(body);
  expect(failed.status).toBe(500);
  callbackFails = false;
  expect(await q('SELECT * FROM history_callback_records')).toHaveLength(0);
  expect((await q('SELECT version FROM member_history_versions WHERE user_id=3 AND project_id=1'))[0].version).toBe(4);
  expect((await save({ ...body, context: { ...context, accountId: '999' } })).status).toBe(403);
  expect((await save({ ...body, context: { ...context, operation: 'confirm_money' } })).status).toBe(422);
  expect((await save({ ...body, context: { ...context, sourceVersion: 'stale' } })).status).toBe(409);
  const saved = await save(body);
  expect(saved.status, saved.text).toBe(200);
  expect(saved.body.data.refreshStatus).toEqual({ status: 'refreshed', recalculated: 2, resumed: 1 });
  expect((await save(body)).body.data).toEqual(saved.body.data);
  expect(await q('SELECT * FROM history_callback_records')).toHaveLength(1);
  expect(seen.at(-1)?.context).toEqual(context);
});
