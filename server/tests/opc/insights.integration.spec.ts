import { beforeAll, afterAll, it, expect } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Router, type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { ModuleManifest } from '../../src/core/contracts';
import type { EarningSourceInput } from '../../src/core/earnings';
import type { AuthUser } from '../../src/types';

let container: StartedMySqlContainer, c: mysql.Connection, app: Express, db: typeof import('../../src/db').db;
const scope = { moduleId: 'insights-test', projectId: '1', accountId: '1' };
const from = '2026-10-01', to = '2026-10-31';
const headers: Record<string, Record<string, string>> = {};
const people = [ ['1','admin','all'], ['2','creator','all'], ['3','leader','all'], ['4','admin','operations'], ['5','admin','finance'], ['6','creator','all'], ['7','leader','all'], ['8','developer','all'], ['9','operator','operations'] ] as const;
const manifest: ModuleManifest = { id: scope.moduleId, name: '真实统计验证', version: '1', contractVersion: 2, roles: ['admin','developer','operator','leader','creator'], permissions: {}, capabilities: [], entryPath: '/tasks' };
const get = (path: string, actor = '1', query: object = {}) => request(app).get('/api/v1/core/' + path).set(headers[actor]).query(query);
const post = (path: string, actor = '1', body: object = {}) => request(app).post('/api/v1/core/' + path).set(headers[actor]).send(body);
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').withDatabase('scoped_insights').withUsername('test').withUserPassword('isolated').start();
  const target = { host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getUserPassword() };
  Object.assign(process.env, { DB_HOST: target.host, DB_PORT: String(target.port), DB_NAME: target.database, DB_USER: target.user, DB_PASS: target.password, OPC_MODULES: '', QUEUE_DRIVER: 'memory', DEV_DEMO_AUTH: '0' });
  await runOpcMigrations(target, []); c = await mysql.createConnection(target);
  for (const [id, role, duty] of people) await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,parent_id) VALUES(?,?,?,?,?,?,?)', [id,'insight'+id,'unused',role,duty,['2','6'].includes(id) ? '同名达人' : '成员'+id, null]);
  await c.query('UPDATE users SET parent_id=7 WHERE id IN (2,6)');
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'选中项目','one'),(2,'其他项目','two')");
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,6),(1,7),(2,2)');
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('insights-test','1')");
  await c.query("INSERT INTO integration_accounts(id,module_id,account_key,name) VALUES(1,'insights-test','one','来源一'),(2,'insights-test','two','来源二')");
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1),(2,2)');
  const dbModule = await import('../../src/db'); db = dbModule.db;
  const earnings = await import('../../src/core/earnings');
  const admin: AuthUser = { sub: '1', role: 'admin', adminDuty: 'all', parentId: null, displayName: '管理员', username: 'insight1', jti: randomUUID() };
  const value = (n: number, activation = false): EarningSourceInput => ({ sourceKey: 'line'+n, version: 'v1', date: '2026-10-10', taskId: 'task'+n, taskName: '任务'+n, metricType: activation ? 'activation' : 'new_user', metricLabel: activation ? '拉活' : '拉新', unit: activation ? '个' : '单',
    lines: [{ payeeId: activation ? '6' : '2', performerId: activation ? '6' : '2', performerName: '同名达人', ruleCode: 'creator', quantity: activation ? '2' : '1', unitPrice: activation ? '1.2000' : '8.0000', amount: activation ? '2.4000' : '8.0000', internal: false, ready: true, reason: '', next: '财务：核对并确认' },
      { payeeId: '3', performerId: activation ? '6' : '2', performerName: '同名达人', ruleCode: 'team', quantity: activation ? '2' : '1', unitPrice: activation ? '0.4000' : '0.5000', amount: activation ? '0.8000' : '0.5000', internal: false, ready: true, reason: '', next: '财务：核对并确认' }] });
  await dbModule.withTransaction(async conn => {
    for (let n = 0; n < 125; n++) {
      const input = value(n, n >= 120);
      await earnings.writeEarningLines(conn, scope, input);
      if (n < 110) await earnings.confirmEarningSource(conn, admin, scope, input.sourceKey, input.version);
    }
    const correction = value(0); correction.version = 'v2'; correction.lines[0].amount = '7.0000'; correction.lines[1].amount = '0.4000';
    await earnings.writeEarningLines(conn, scope, correction); await earnings.confirmEarningSource(conn, admin, scope, correction.sourceKey, correction.version);
    const missing = value(125, true); missing.date = '2026-10-11';
    for (const line of missing.lines) { line.quantity = null; line.unitPrice = null; line.amount = null; line.ready = false; line.reason = '资料待补齐'; }
    await earnings.writeEarningLines(conn, scope, missing);
    await earnings.writeEarningLines(conn, { ...scope, projectId: '2', accountId: '2' }, value(999));
  });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  for (const [id, status, amount, paidOn] of [['1','pending','12.5000',null], ['2','approved','22.0000',null], ['3','paid','100.0000',today], ['4','paid','20.0000','2020-01-01']] as const)
    await c.query('INSERT INTO opc_withdrawals(id,module_id,project_id,account_id,user_id,amount,request_key,request_hash,status,paid_on,paid_at,pay_method) VALUES(?,?,?,?,?,?,?,?,?,?,IF(? IS NULL,NULL,NOW(3)),?)', [id,scope.moduleId,'1','1','3',amount,'request'+id,'0'.repeat(64),status,paidOn,paidOn,'bank']);
  const { ModuleRuntime } = await import('../../src/core/module-runtime'), { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([manifest]); runtime.register({ manifest, router: Router() }); app = createCoreApp(runtime);
  const { signToken } = await import('../../src/auth/jwt'), { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  for (const [id, role, adminDuty] of people) {
    const client = 'insight-client-'+id, session = await issueRefreshSession(id, { type: 'web', id: client });
    headers[id] = { 'X-Client-Id': client, Authorization: 'Bearer '+await signToken({ id, username: 'insight'+id, role, adminDuty, parentId: ['2','6'].includes(id) ? '7' : null, displayName: '成员'+id, sessionId: session.familyId }) };
  }
}, 90000);
afterAll(async () => { await db?.end(); await c?.end(); await container?.stop(); }, 30000);

it.each(['summary','daily','team-top','retention','relation-forest','live-feed'])('insights/%s 拒绝成员越权', async name => {
  expect((await get('insights/'+name, '2', { from,to })).status).toBe(403);
  expect((await get('insights/'+name, '3', { from,to })).status).toBe(403);
});
it.each(['dev-summary','dev-daily','dev-workers','dev-activity','dev-inspections','dev-queue'])('%s 拒绝非开发者', async name => {
  expect((await get('insights/'+name, '1')).status).toBe(403);
  expect((await get('insights/'+name, '4')).status).toBe(403);
});
it.each(['today-payouts','reconcile-progress','withdrawals/pending'])('finance/%s 在后端拒绝运营和成员', async name => {
  for (const actor of ['2','3','4','9']) expect((await get('finance/'+name, actor, { from,to })).status).toBe(403);
});
it('生产读取不依赖项目表，所有查询以同一项目来源范围聚合并拒绝伪造组合', async () => {
  const response = await get('insights/summary','5',{ ...scope,from,to }); expect(response.status,response.text).toBe(200);
  const data = response.body.data;
  expect(data.taskCount).toBe(126); expect(data.activeMembers).toBe(2); expect(data.memberPayout).toBe('933.9000');
  expect(data.expectedAmount).toBeNull(); expect(data.knownExpectedAmount).toBe('1034.9000'); expect(data.pendingCalculations).toBe(2);
  expect(data.upstream).toBeNull(); expect(data.retention).toBeNull(); expect(data.availability.upstream.available).toBe(false);
  expect(data.scope.scopes).toHaveLength(1);
  const top = await get('insights/team-top','5',{ ...scope,from,to });
  expect(top.body.data.list[0].detail.query).toMatchObject({ ...scope,from,to,payeeId:'3' });
  expect(top.body.data.list[0].quantities.find((v:{metricType:string})=>v.metricType==='activation').quantity).toBeNull();
  expect((await get('insights/summary','5',{...scope,accountId:'2',from,to})).status).toBe(403);
  expect((await get('insights/summary','5',{...scope,from:to,to:from})).status).toBe(422);
});
it('运营统计没有金额字段或单价，空缺数量保持待核对，分页仍有全量总数', async () => {
  for (const actor of ['4','9']) {
    for (const name of ['summary','daily','team-top','retention','live-feed']) {
      const response = await get('insights/'+name,actor,{...scope,from,to,pageSize:2}); expect(response.status,response.text).toBe(200);
      expect(JSON.stringify(response.body.data)).not.toMatch(/"(?:amount|knownAmount|unitPrice|memberPayout|upstream|grossAmount|netAmount|retention)":/);
    }
  }
  const feed = await get('insights/live-feed','4',{...scope,from,to,pageSize:1});
  expect(feed.body.data.total).toBe(126); expect(feed.body.data.list[0].quantityValue).toBeNull(); expect(feed.body.data.list[0].detail.sourceId).toBeTruthy();
});
it('团长汇总覆盖超过100行，同名成员按ID分开，转团不改变旧分成，原成员金额不外泄', async () => {
  const response = await get('member-summary/contributors','3',{...scope,from,to,pageSize:1}); expect(response.status,response.text).toBe(200);
  const data = response.body.data;
  expect(data.total).toBe(2); expect(data.summary.records).toBe(126); expect(data.summary.knownAmount).toBe('63.9000'); expect(data.summary.confirmedAmount).toBe('54.9000'); expect(data.summary.amount).toBeNull();
  expect(data.list[0]).toMatchObject({performerId:'2',name:'同名达人',amount:'59.9000',confirmedAmount:'54.9000',records:120});
  const second = await get('member-summary/contributors','3',{...scope,from,to,page:2,pageSize:1});
  expect(second.body.data.list[0]).toMatchObject({performerId:'6',name:'同名达人',amount:null,knownAmount:'4.0000'});
  expect(second.body.data.summary).toEqual(data.summary); expect(second.body.data.list[0].quantities[0].metricType).toBe('activation'); expect(second.body.data.list[0].quantities[0].quantity).toBeNull();
  const detail = await get('earnings/mine','3',{projectId:'1',accountId:'1',from,to,group:'team',performerId:'2',pageSize:100});
  expect(detail.status,detail.text).toBe(200); expect(detail.body.data.summary.amount).toBe('59.9000'); expect(detail.body.data.total).toBe(120);
  const unknownDetail = await get('earnings/mine','3',{...scope,from,to,group:'team',performerId:'6'});
  expect(unknownDetail.status,unknownDetail.text).toBe(200);
  expect(unknownDetail.body.data.summary).toMatchObject({amount:null,knownAmount:'4.0000',pendingAmount:null,pendingCalculations:1});
  expect(unknownDetail.body.data.groups[0]).toMatchObject({amount:null,knownAmount:'4.0000',quantity:null});
  expect((await get('earnings/mine','3',{...scope,moduleId:'other',from,to,group:'team',performerId:'6'})).status).toBe(403);
  const newLeader = await get('member-summary/contributors','7',{...scope,from,to}); expect(newLeader.body.data.summary.knownAmount).toBe('0.0000');
  for (const actor of ['1','2','4','5']) expect((await get('member-summary/contributors',actor,{...scope,from,to})).status).toBe(403);
  expect((await get('member-summary/contributors','3',{...scope,projectId:'2',accountId:'2',from,to})).status).toBe(403);
});
it('当前待审批、待付款和实际支付日期分别计数，不用所选业务日期裁掉跨期余额', async () => {
  const response = await get('finance/withdrawals/pending','5',{...scope,from,to}); expect(response.status,response.text).toBe(200);
  expect(response.body.data).toMatchObject({count:1,totalAmount:'12.5000',approvedCount:1,approvedAmount:'22.0000',todayPaid:'100.0000',failedCount:null});
  expect(response.body.data.oldest[0].id).toBe('1');
  const today = await get('finance/today-payouts','5',{...scope,from,to}); expect(today.body.data.count).toBe(1); expect(today.body.data.list[0].amount).toBe('100.0000'); expect(today.body.data.timeBasis).toBe('actual_payment_date');
  const progress = await get('finance/reconcile-progress','5',{...scope,from,to}); expect(progress.status,progress.text).toBe(200);
  expect(progress.body.data.totalDays).toBe(2); expect(progress.body.data.checkedDays).toBe(1); expect(progress.body.data.coverage).toBe('observed_project_business_days_only');
});
it('关系图使用当前范围内真实成员与稳定ID，财务不能读取成员关系', async () => {
  expect((await get('insights/relation-forest','5',{...scope,from,to})).status).toBe(403);
  const response = await get('insights/relation-forest','4',{...scope,from,to}); expect(response.status,response.text).toBe(200);
  expect(response.body.data.roots.find((r:{id:string})=>r.id==='7').children.map((r:{id:string})=>r.id)).toEqual(['2','6']);
});
it('开发者读取真实内存队列并运行当前连通检查，历史和心跳缺项不伪造通过', async () => {
  const queue = await get('insights/dev-queue','8'); expect(queue.status,queue.text).toBe(200); expect(queue.body.data.driver).toBe('memory'); expect(queue.body.data.historyScope).toBe('current_process_in_flight'); expect(queue.body.data.successRate).toBeNull();
  const jobs = await import('../../src/queue');
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  jobs.registerJob('insights-observation', () => running);
  await jobs.enqueue('insights-observation', { privatePayload: 'must-not-be-exposed' }, { jobId: 'observation-test-job' });
  try {
    const active = await get('insights/dev-queue','8');
    expect(active.body.data.backlog).toBe(1); expect(active.body.data.counts.completed).toBeNull();
    expect(active.body.data.rows[0]).toMatchObject({ id:'observation-test-job',state:'in_flight' });
    expect(JSON.stringify(active.body.data)).not.toContain('privatePayload');
  } finally { finish(); }
  await new Promise(resolve => setImmediate(resolve));
  expect((await get('insights/dev-queue','8')).body.data.backlog).toBe(0);
  const trend = await get('insights/dev-daily','8'); expect(trend.body.data.status).toBe('unavailable');
  const workers = await get('insights/dev-workers','8'); expect(workers.body.data.capabilities.workerHeartbeats).toBe(false);
  for (const actor of ['1','2','4','5']) expect((await post('insights/dev-inspections/run',actor)).status).toBe(403);
  const run = await post('insights/dev-inspections/run','8'); expect(run.status,run.text).toBe(200); expect(run.body.data.saved).toBe(false); expect(run.body.data.scope).toBe('current_connectivity_only'); expect(run.body.data.records).toHaveLength(2);
  const again = await get('insights/dev-inspections','8'); expect(again.body.data.records).toEqual([]); expect(again.body.data.canRun).toBe(true);
});
it('新读取接口未登录被拒绝', async () => {
  expect((await request(app).get('/api/v1/core/insights/summary')).status).toBe(401);
  expect((await request(app).get('/api/v1/core/finance/today-payouts')).status).toBe(401);
});
it('当前来源移除旧收款人时，排行与详情共同保留原已确认账，确认更正后按净额更新', async () => {
  const { withTransaction } = await import('../../src/db'), earnings = await import('../../src/core/earnings');
  const admin: AuthUser = { sub:'1',role:'admin',adminDuty:'all',parentId:null,displayName:'管理员',username:'insight1',jti:randomUUID() };
  const original: EarningSourceInput = { sourceKey:'removed-payee',version:'v1',date:'2026-10-12',taskId:'removed-payee',taskName:'保留旧收款人',metricType:'new_user',metricLabel:'拉新',unit:'单',lines:[
    {payeeId:'2',performerId:'2',performerName:'同名达人',ruleCode:'creator',quantity:'1',unitPrice:'8.0000',amount:'8.0000',internal:false,ready:true,reason:'',next:'财务：确认'},
    {payeeId:'3',performerId:'2',performerName:'同名达人',ruleCode:'team',quantity:'1',unitPrice:'0.5000',amount:'0.5000',internal:false,ready:true,reason:'',next:'财务：确认'},
  ] };
  await withTransaction(async conn => { await earnings.writeEarningLines(conn,scope,original); await earnings.confirmEarningSource(conn,admin,scope,original.sourceKey,original.version); });
  const before = await q('SELECT * FROM opc_income_entries ORDER BY id');
  const changed: EarningSourceInput = {...original,version:'v2',lines:[{...original.lines[0],amount:'8.5000'}]};
  await withTransaction(conn => earnings.writeEarningLines(conn,scope,changed));
  const contributors = await get('member-summary/contributors','3',{...scope,from,to});
  const detail = await get('earnings/mine','3',{projectId:'1',accountId:'1',from,to,group:'team',performerId:'2'});
  expect(detail.status,detail.text).toBe(200);
  expect(detail.body.data.summary.amount).toBe(contributors.body.data.list.find((x:{performerId:string})=>x.performerId==='2').amount);
  expect(detail.body.data.summary.amount).toBe('60.4000');
  expect(detail.body.data.list.find((x:{taskId:string})=>x.taskId==='removed-payee')).toMatchObject({historicalOnly:1,amount:'0.5000',confirmedAmount:'0.5000',pendingAmount:'0.0000',nextAction:'原已确认收入保留；财务核对当前来源更正后再确认差额'});
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(before);
  await withTransaction(conn => earnings.confirmEarningSource(conn,admin,scope,changed.sourceKey,changed.version));
  const after = await get('member-summary/contributors','3',{...scope,from,to});
  const afterDetail = await get('earnings/mine','3',{projectId:'1',accountId:'1',from,to,group:'team',performerId:'2'});
  expect(afterDetail.body.data.summary.amount).toBe('59.9000');
  expect(afterDetail.body.data.summary.amount).toBe(after.body.data.list.find((x:{performerId:string})=>x.performerId==='2').amount);
  expect(afterDetail.body.data.list.find((x:{taskId:string})=>x.taskId==='removed-payee').nextAction).toBe('更正已确认，可查看原收入与更正明细');
  const oldRows = await q('SELECT * FROM opc_income_entries WHERE id<=? ORDER BY id',[before.at(-1)!.id]); expect(oldRows).toEqual(before);
});
