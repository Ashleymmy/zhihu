import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Router, type Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import type { ModuleRuntime } from '../../src/core/module-runtime';
import type { ModuleManifest } from '../../src/core/contracts';
let container: StartedMySqlContainer, connection: mysql.Connection, app: Express, runtime: ModuleRuntime;
let pool: typeof import('../../src/db').db;
const headers: Record<string, Record<string, string>> = {};
const people = [{ id: '1', role: 'admin', adminDuty: 'all' }, { id: '2', role: 'creator', adminDuty: 'all' }, { id: '3', role: 'admin', adminDuty: 'operations' }];
const manifest: ModuleManifest = { id: 'dashboard-test', name: '测试项目', version: '1', contractVersion: 1,
  roles: ['admin', 'creator'], capabilities: [], permissions: {}, entryPath: '/tasks' };
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').withDatabase('dashboard_test').withUsername('test').withUserPassword('isolated').start();
  const target = { host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getUserPassword() };
  Object.assign(process.env, { NODE_ENV: 'test', OPC_MODULES: '', QUEUE_DRIVER: 'memory', DB_HOST: target.host, DB_PORT: String(target.port), DB_NAME: target.database, DB_USER: target.user, DB_PASS: target.password, JWT_SECRET: 'dashboard_isolated_secret_more_than_32_chars' });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []); connection = await mysql.createConnection(target);
  for (const person of people) await connection.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,is_active,must_change_pwd) VALUES(?,?,?, ?,?,?,1,0)', [person.id, 'user' + person.id, 'unused', person.role, person.adminDuty, '测试' + person.id]);
  await connection.query("INSERT INTO projects(id,name,slug) VALUES(1,'可见项目','visible'),(2,'另一个项目','private')");
  await connection.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2)');
  await connection.query("INSERT INTO module_installations(module_id,version) VALUES('dashboard-test','1')");
  await connection.query("INSERT INTO integration_accounts(id,module_id,account_key,name,created_by) VALUES(1,'dashboard-test','one','测试连接一',1),(2,'dashboard-test','two','测试连接二',1)");
  await connection.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1),(2,2)');
  const { ModuleRuntime } = await import('../../src/core/module-runtime'); runtime = new ModuleRuntime([manifest]);
  runtime.register({ manifest, router: Router(), todoProvider: { overview: async (scope) => ({ todos: [{ kind: 'work', count: Number(scope.projectId), label: '作品待处理', actor: '本人', actionLabel: '查看作品', path: '/works?projectId=' + scope.projectId }], metrics: [{ key: 'work', label: '作品', value: '2', unit: '篇', path: '/works' }, { key: 'money', label: '收益', value: '16.0000', unit: '元', path: '/income' }] }) } });
  app = (await import('../../src/core/app')).createCoreApp(runtime); pool = (await import('../../src/db')).db;
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'), { signToken } = await import('../../src/auth/jwt');
  for (const person of people) {
    const client = 'dashboard-client-' + person.id, session = await issueRefreshSession(person.id, { type: 'web', id: client });
    headers[person.id] = { 'X-Client-Id': client, Authorization: 'Bearer ' + await signToken({ ...person, role: person.role as AuthUser['role'], adminDuty: person.adminDuty as AuthUser['adminDuty'], username: 'user' + person.id, displayName: '测试' + person.id, parentId: null, sessionId: session.familyId }) };
  }
}, 90000);
afterAll(async () => { await pool?.end(); await connection?.end(); await container?.stop({ remove: true, removeVolumes: true }); }, 30000);
const get = (id = '1', projectId?: string) => request(app).get('/api/v1/core/dashboard').set(headers[id]).query(projectId ? { projectId } : {});
it('aggregates optional module providers without any project tables and respects project membership', async () => {
  const result = await get('2'); expect(result.status).toBe(200);
  expect(result.body.data.groups.map((p: { id: string }) => p.id)).toEqual(['1']);
  expect(result.body.data.groups[0].services[0].todos[0].count).toBe(1);
  expect((await get('2', '2')).status).toBe(403);
  expect((await request(app).get('/api/v1/core/dashboard')).status).toBe(401);
});
it('returns staff scope but never serializes monetary metrics to operations', async () => {
  const result = await get('3'); expect(result.status).toBe(200); expect(result.body.data.groups).toHaveLength(2);
  expect(result.body.data.groups.every((p: { services: { metrics: { unit: string }[] }[] }) => p.services.every(service => service.metrics.every(metric => metric.unit !== '元')))).toBe(true);
  expect((await get('1')).body.data.groups[0].services[0].metrics.some((metric: { unit: string }) => metric.unit === '元')).toBe(true);
});
it('preserves a project failure instead of falsely declaring that all work is done', async () => {
  const provider = runtime.get(manifest.id)!.todoProvider!; const original = provider.overview;
  provider.overview = async (scope, user) => { if (scope.projectId === '2') throw Error('private upstream error'); return original(scope, user); };
  try {
    const result = await get(); expect(result.status).toBe(200);
    expect(result.body.data.groups.map((p: { services: { status: string }[] }) => p.services[0].status)).toEqual(['ready', 'unavailable']);
    expect(JSON.stringify(result.body)).not.toContain('private upstream error');
  } finally { provider.overview = original; }
});
it('validates dates and refuses missing or disabled projects', async () => {
  expect((await get('1', '99999')).status).toBe(404);
  expect((await request(app).get('/api/v1/core/dashboard').set(headers['1']).query({ from: '2026-02-30' })).status).toBe(422);
});

it('hides intentionally disabled modules while preserving initialization failures for retry',async()=>{
 const {ModuleRuntime}=await import('../../src/core/module-runtime'),{dashboard}=await import('../../src/core/dashboard');
 const user={sub:'2',role:'creator',parentId:null,username:'user2',displayName:'测试2',adminDuty:'all',jti:'test'} as AuthUser;
 const empty=new ModuleRuntime([manifest]);
 const result=await dashboard(empty,user,{from:'2026-10-01',to:'2026-10-09'});expect(result.projects).toEqual([]);expect(result.groups).toEqual([]);
 empty.failures.set(manifest.id,'initialization_failed');const failed=await dashboard(empty,user,{from:'2026-10-01',to:'2026-10-09'});expect(failed.groups).toHaveLength(1);expect(failed.groups[0].services[0].status).toBe('unavailable');
 const privateRuntime=new ModuleRuntime([{...manifest,roles:['admin']}]);privateRuntime.failures.set(manifest.id,'initialization_failed');expect((await dashboard(privateRuntime,user,{from:'2026-10-01',to:'2026-10-09'})).groups).toEqual([]);
});
