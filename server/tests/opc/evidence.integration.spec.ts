import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Router, type Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import type { ModuleRuntime } from '../../src/core/module-runtime';
import type { EvidenceResult, EvidenceRow, ModuleManifest } from '../../src/core/contracts';

const actors = [
  { id: '1', role: 'admin', adminDuty: 'all' }, { id: '2', role: 'admin', adminDuty: 'operations' },
  { id: '3', role: 'admin', adminDuty: 'finance' }, { id: '4', role: 'creator', adminDuty: 'all' },
  { id: '5', role: 'leader', adminDuty: 'all' },
] as const;
const manifest: ModuleManifest = { id: 'evidence-test', name: '资料测试', version: '1', contractVersion: 2,
  roles: ['admin', 'creator', 'leader'], capabilities: [], permissions: {}, entryPath: '/tasks' };
let container: StartedMySqlContainer, c: mysql.Connection, pool: typeof import('../../src/db').db, runtime: ModuleRuntime, app: Express;
const headers: Record<string, Record<string, string>> = {};
let mode = 'normal', calls = 0;
const params = { moduleId: manifest.id, projectId: '1', accountId: '1', from: '2026-09-01', to: '2026-09-01' };
const get = (actor = '1', extra = {}) => request(app).get('/api/v1/core/evidence').set(headers[actor]).query({ ...params, ...extra });

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').withDatabase('core_evidence_test').withUsername('test').withUserPassword('isolated').start();
  const target = { host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getUserPassword() };
  Object.assign(process.env, { NODE_ENV: 'test', OPC_MODULES: '', QUEUE_DRIVER: 'memory', DB_HOST: target.host,
    DB_PORT: String(target.port), DB_NAME: target.database, DB_USER: target.user, DB_PASS: target.password, DEV_DEMO_AUTH: '0' });
  await runOpcMigrations(target, []); c = await mysql.createConnection(target);
  for (const actor of actors) await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name) VALUES(?,?,?,?,?,?)', [actor.id, 'evidence'+actor.id, 'unused', actor.role, actor.adminDuty, '资料人员'+actor.id]);
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'资料项目','evidence'),(2,'其他项目','other-evidence')");
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('evidence-test','1')");
  await c.query("INSERT INTO integration_accounts(id,module_id,account_key,name) VALUES(1,'evidence-test','one','资料来源'),(2,'evidence-test','two','其他来源')");
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1),(2,2)');
  const { ModuleRuntime } = await import('../../src/core/module-runtime'); runtime = new ModuleRuntime([manifest]);
  const ready = { status: 'ready' as const, reason: '资料已齐', sourceRefs: [] };
  runtime.register({ manifest, router: Router(), dataProvider: {
    summary: async scope => ({ ...scope, moduleId: manifest.id, status: 'empty', updatedAt: '', metrics: [] }),
    evidence: async (scope, _user, filter) => {
      calls++;
      if (mode === 'failure') throw Error('PRIVATE_DATABASE_FAILURE');
      const total = mode === 'empty' ? 0 : 102;
      const list: EvidenceRow[] = Array.from({ length: Math.max(0, Math.min(filter.pageSize, total - (filter.page - 1) * filter.pageSize)) }, (_, index) => ({
        key: { projectId: mode === 'wrong-scope' ? '2' : scope.projectId, accountId: scope.accountId, channelRef: filter.channelRef ?? '1',
          taskRef: filter.taskRef ?? String((filter.page - 1) * filter.pageSize + index + 1), businessDate: scope.from, metricType: filter.metricType ?? 'quantity' },
        title: '测试任务', official: { status: 'valid_zero', quantity: '0', quantityUnit: '条', coverageBasis: 'observed_rows', coverageIsExhaustive: false, sourceRefs: [], currentRevision: '1', pendingConflict: [] },
        checks: { work: ready, historicalOwnership: ready, projectParticipation: ready, pricing: ready, existingCalculation: ready },
        result: { status: 'ready', reason: '可继续核对', responsibleRole: null, nextAction: null, evidenceVersion: 'saved-version-1', lastChangedAt: null },
        finance: { amount: '12.3400', currency: 'CNY', sourceRefs: [] },
      }));
      const result: EvidenceResult = { ...scope, moduleId: manifest.id, status: total ? 'ready' : 'empty', list: mode === 'truncated' ? list.slice(1) : list, total,
        page: filter.page, pageSize: filter.pageSize, limits: { maxDays: 31, maxPageSize: 100 } };
      return { ...result, secretAmount: '99999', list: result.list.map(row => ({ ...row, rawMoney: '99999' })) };
    },
  } });
  app = (await import('../../src/core/app')).createCoreApp(runtime); pool = (await import('../../src/db')).db;
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'), { signToken } = await import('../../src/auth/jwt');
  for (const actor of actors) {
    const client = 'core-evidence-client-'+actor.id, session = await issueRefreshSession(actor.id, { type: 'web', id: client });
    headers[actor.id] = { 'X-Client-Id': client, Authorization: 'Bearer '+await signToken({ ...actor, username: 'evidence'+actor.id, displayName: '资料人员', parentId: null, sessionId: session.familyId }) };
  }
}, 90000);
afterAll(async () => { await pool?.end(); await c?.end(); await container?.stop({ remove: true, removeVolumes: true }); });

it('实际挂载通用核验提供器，100 条为每页限制，后续页和总数保留', async () => {
  const first = await get('1', { pageSize: 100 }); expect(first.status, first.text).toBe(200);
  expect(first.body.data).toMatchObject({ total: 102, page: 1, pageSize: 100, limits: { maxDays: 31, maxPageSize: 100 } });
  expect(first.body.data.list).toHaveLength(100);
  const next = await get('1', { pageSize: 100, page: 2 }); expect(next.status, next.text).toBe(200);
  expect(next.body.data.list.map((row: EvidenceRow) => row.key.taskRef)).toEqual(['101', '102']);
  expect(next.body.data.total).toBe(102);
  const beyond = await get('1', { pageSize: 100, page: 3 }); expect(beyond.status).toBe(200); expect(beyond.body.data).toMatchObject({ status: 'ready', list: [], total: 102 });
});
it('运营投影排除金额，财务和完整管理员可读取，未知字段不穿透', async () => {
  for (const actor of ['1', '3']) expect((await get(actor)).body.data.list[0].finance.amount).toBe('12.3400');
  const operations = await get('2'); expect(operations.status).toBe(200);
  expect(operations.text).not.toMatch(/amount|finance|rawMoney|99999/i);
  expect((await get()).text).not.toMatch(/rawMoney|secretAmount/);
});
it('成员、团长和未认证均拒绝，跨来源或停用范围在提供器调用前拒绝', async () => {
  const before = calls;
  for (const actor of ['4', '5']) expect((await get(actor)).status).toBe(403);
  expect((await request(app).get('/api/v1/core/evidence').query(params)).status).toBe(401);
  expect((await get('1', { accountId: '2' })).status).toBe(403);
  expect((await get('1', { projectId: '999' })).status).toBe(403);
  await c.query('UPDATE projects SET is_enabled=0 WHERE id=1');
  try { expect((await get()).status).toBe(403); } finally { await c.query('UPDATE projects SET is_enabled=1 WHERE id=1'); }
  await c.query("UPDATE integration_accounts SET status='disabled' WHERE id=1");
  try { expect((await get()).status).toBe(403); } finally { await c.query("UPDATE integration_accounts SET status='active' WHERE id=1"); }
  expect(calls).toBe(before);
});
it('当前岗位重新读取，旧身份不能保留财务权限', async () => {
  await c.query("UPDATE users SET admin_duty='operations' WHERE id=3");
  try { const response = await get('3'); expect(response.status).toBe(200); expect(response.text).not.toContain('12.3400'); }
  finally { await c.query("UPDATE users SET admin_duty='finance' WHERE id=3"); }
});
it('日期、分页和过滤范围无效时拒绝；31 天可分期查询', async () => {
  for (const extra of [{ to: '2026-10-02' }, { from: '2026-02-30' }, { pageSize: 101 }, { page: 0 }, { taskRef: '1', keywordRef: '2' }, { operation: 'pay' }])
    expect((await get('1', extra)).status).toBe(422);
  expect((await get('1', { from: '2026-10-01', to: '2026-10-31' })).status).toBe(200);
  expect((await get('1', { from: '2026-11-01', to: '2026-11-30' })).status).toBe(200);
});
it('不可用、失败、串范围与截断页明确报错，真实无记录才返回空结果', async () => {
  const provider = runtime.get(manifest.id)!.dataProvider!;
  const original = provider.evidence; provider.evidence = undefined;
  try { expect((await get()).status).toBe(503); } finally { provider.evidence = original; }
  for (const value of ['failure', 'wrong-scope', 'truncated']) {
    mode = value; const response = await get(); expect(response.status, response.text).toBe(502); expect(response.text).not.toContain('PRIVATE_DATABASE_FAILURE');
  }
  mode = 'empty'; const empty = await get(); mode = 'normal';
  expect(empty.status).toBe(200); expect(empty.body.data).toMatchObject({ status: 'empty', total: 0, list: [] });
});
