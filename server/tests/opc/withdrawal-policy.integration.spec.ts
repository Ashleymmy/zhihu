import crypto from 'node:crypto';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Router, type Express } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import type { ModuleManifest } from '../../src/core/contracts';
let container: StartedMySqlContainer,
  c: mysql.Connection,
  app: Express,
  db: typeof import('../../src/db').db,
  finance: typeof import('../../src/core/finance');
const scope = { moduleId: 'sample-withdrawal', projectId: '1', accountId: '1' },
  second = { ...scope, projectId: '2', accountId: '2' };
const actors: AuthUser[] = Array.from({ length: 12 }, (_, i) => ({
  sub: String(i + 1),
  username: 'person' + (i + 1),
  displayName: '测试' + (i + 1),
  role: i === 0 || i === 3 ? 'admin' : i === 2 || i === 5 ? 'leader' : 'creator',
  adminDuty: i === 3 ? 'operations' : 'all',
  parentId: null,
  jti: crypto.randomUUID(),
}));
const headers: Record<string, Record<string, string>> = {};
const q = async (sql: string, args: unknown[] = []) => (await c.query<mysql.RowDataPacket[]>(sql, args))[0];
const path = '/api/v1/core/finance';
const get = (who: number, p: string, query: object = scope) =>
  request(app)
    .get(path + p)
    .set(headers[String(who)])
    .query(query);
const post = (who: number, p: string, body: object) =>
  request(app)
    .post(path + p)
    .set(headers[String(who)])
    .send(body);
async function apply(who: number, amount: string, s = scope, key = crypto.randomUUID()) {
  const quoted = await get(who, '/withdrawal-quote', { ...s, amount });
  expect(quoted.status, quoted.text).toBe(200);
  const body = {
    ...s,
    amount,
    requestKey: key,
    receiverName: '测试收款人',
    payMethod: 'bank',
    payAccount: 'TEST-NOT-A-REAL-ACCOUNT',
    policyVersion: quoted.body.data.policyVersion,
    quoteToken: quoted.body.data.quoteToken,
  };
  const response = await post(who, '/withdrawals', body);
  expect(response.status, response.text).toBe(201);
  return { id: response.body.data.id, body, quote: quoted.body.data };
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('withdrawal_test')
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
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    OPC_MODULES: '',
    OPC_WITHDRAWAL_POLICY_ENABLED: '1',
    WECHAT_APP_ID: 'wx0000000000000001',
    WECHAT_BRIDGE_SECRET: 'isolated_withdrawal_bridge_secret_long_enough',
    MINI_CONTENT_SAFETY_REQUIRED: '0',
    QUEUE_DRIVER: 'memory',
  });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []);
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  for (const a of actors)
    await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name) VALUES(?,?,?,?,?,?)', [
      a.sub,
      a.username,
      'unused',
      a.role,
      a.adminDuty,
      a.displayName,
    ]);
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'隔离一','one'),(2,'隔离二','two')");
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('sample-withdrawal','1')");
  await c.query(
    "INSERT INTO integration_accounts(id,module_id,account_key,name,created_by) VALUES(1,'sample-withdrawal','one','测试一',1),(2,'sample-withdrawal','two','测试二',1)",
  );
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1),(2,2)');
  for (const a of actors)
    await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,?),(2,?)', [a.sub, a.sub]);
  const database = await import('../../src/db');
  db = database.db;
  finance = await import('../../src/core/finance');
  const manifest: ModuleManifest = {
    id: scope.moduleId,
    name: '隔离提现',
    version: '1',
    contractVersion: 2,
    roles: ['admin', 'leader', 'creator'],
    permissions: {},
    capabilities: [],
    entryPath: '/tasks',
  };
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { createCoreApp } = await import('../../src/core/app');
  const runtime = new ModuleRuntime([manifest]);
  runtime.register({ manifest, router: Router() });
  app = createCoreApp(runtime);
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  for (const a of actors) {
    const client = 'withdrawal-test-client-' + a.sub,
      session = await issueRefreshSession(a.sub, { type: 'web', id: client });
    headers[a.sub] = {
      'X-Client-Id': client,
      Authorization: 'Bearer ' + (await signToken({ ...a, id: a.sub, sessionId: session.familyId })),
    };
  }
  for (const s of [scope, second]) {
    const allocations = actors
      .filter((a) => !['admin'].includes(a.role))
      .map((a) => ({ userId: a.sub, amount: '2000.0000' }));
    await database.withTransaction((conn) =>
      finance.syncIncome(conn, actors[0], s, {
        sourceKey: 'synthetic-funds',
        version: '1',
        date: '2026-10-13',
        description: '隔离资金，无实际转账',
        allocations,
        total: String(allocations.length * 2000),
      }),
    );
    const view = await finance.financeOverview(actors[0], s);
    await finance.releaseFunding(actors[0], s, view.funding.hash, 'isolated test', crypto.randomUUID());
  }
}, 90000);
afterAll(async () => {
  delete process.env.OPC_WITHDRAWAL_POLICY_ENABLED;
  await db?.end();
  await c?.end();
  await container?.stop();
}, 30000);

it('accepts sub-ten-yuan amounts and enforces consent version, amount tampering and read access on real HTTP', async () => {
  expect((await get(2, '/withdrawal-quote', { ...scope, amount: '0.01' })).status).toBe(200);
  expect((await get(2, '/withdrawal-quote', { ...scope, amount: '2000.01' })).status).toBe(422);
  expect((await get(4, '/withdrawal-quote', { ...scope, amount: '100' })).status).toBe(403);
  expect((await get(4, '/withdrawal-policy', {})).status).toBe(403);
  expect((await get(2, '/withdrawal-quote', { ...scope, projectId: '999', amount: '100' })).status).toBe(403);
  expect((await post(2, '/withdrawals', { ...scope, amount: '100', requestKey: crypto.randomUUID() })).status).toBe(
    409,
  );
  const quote = (await get(2, '/withdrawal-quote', { ...scope, amount: '100' })).body.data;
  expect(
    (
      await post(2, '/withdrawals', {
        ...scope,
        amount: '99',
        policyVersion: quote.policyVersion,
        quoteToken: quote.quoteToken,
        requestKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(409);
});
it('reserves gross, pays net once, preserves income, and retains original intent on retry', async () => {
  const income = await q('SELECT * FROM opc_income_entries ORDER BY id');
  const entry = await apply(2, '100');
  expect(entry.quote).toMatchObject({ feeAmount: '1.0000', netAmount: '99.0000' });
  const duplicate = await post(2, '/withdrawals', entry.body);
  expect(duplicate.body.data.id).toBe(entry.id);
  expect((await get(2, '')).body.data.balance.available).toBe('1900.0000');
  expect(
    (
      await post(1, '/withdrawals/' + entry.id + '/pay', {
        ...scope,
        paidOn: entry.quote.appliedDay,
        acknowledged: true,
        requestKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(409);
  expect((await post(1, '/withdrawals/' + entry.id + '/review', { ...scope, action: 'approve' })).status).toBe(200);
  const payment = {
    ...scope,
    paidOn: entry.quote.appliedDay,
    acknowledged: true,
    requestKey: crypto.randomUUID(),
    policyVersion: entry.quote.policyVersion,
    netAmount: entry.quote.netAmount,
  };
  expect((await post(1, '/withdrawals/' + entry.id + '/pay', { ...payment, netAmount: '100' })).status).toBe(409);
  expect(
    (
      await post(1, '/withdrawals/' + entry.id + '/pay', {
        ...scope,
        paidOn: entry.quote.appliedDay,
        acknowledged: true,
      })
    ).status,
  ).toBe(409);
  expect((await post(1, '/withdrawals/' + entry.id + '/pay', payment)).status).toBe(200);
  expect((await post(1, '/withdrawals/' + entry.id + '/pay', payment)).status).toBe(200);
  const wallet = (await get(2, '')).body.data;
  expect(wallet.balance).toMatchObject({ available: '1900.0000', paid: '99.0000', processing: '0.0000' });
  expect(wallet.withdrawals[0]).toMatchObject({
    amount: '100.0000',
    feeAmount: '1.0000',
    netAmount: '99.0000',
    invoiceRequired: false,
  });
  expect(await q('SELECT * FROM opc_income_entries ORDER BY id')).toEqual(income);
  expect((await post(2, '/withdrawals', entry.body)).body.data.id).toBe(entry.id);
});
it('serializes concurrent requests across projects and releases cancelled gross quota', async () => {
 const quoted=await Promise.all([scope,second].map(s=>get(5,'/withdrawal-quote',{...s,amount:'60'})));
 const attempts=await Promise.all([scope,second].map((s,i)=>post(5,'/withdrawals',{...s,amount:'60',requestKey:crypto.randomUUID(),policyVersion:quoted[i].body.data.policyVersion,quoteToken:quoted[i].body.data.quoteToken})));
 expect(attempts.map(a=>a.status).sort()).toEqual([201,422]);
 const winner=attempts.findIndex(a=>a.status===201),s=winner===0?scope:second;
 const remainder=await apply(5,'40',s);
 expect((await get(5,'',s)).body.data.withdrawalPolicy).toMatchObject({dailyLimit:null,dailyAmountLimit:'100.0000',todayAmount:'100.0000',remainingAmount:'0.0000'});
 expect((await get(5,'/withdrawal-quote',{...s,amount:'0.01'})).status).toBe(422);
 expect((await post(5,'/withdrawals/'+attempts[winner].body.data.id+'/review',{...s,action:'cancel'})).status).toBe(200);
 expect((await get(5,'',s)).body.data.withdrawalPolicy.remainingAmount).toBe('60.0000');
 await apply(5,'0.01',s);await apply(5,'59.99',s);
 expect((await get(5,'',s)).body.data.withdrawalPolicy.remainingAmount).toBe('0.0000');
 expect(remainder.id).toBeTruthy();
});
// Pre-v2 requests are fixtures of already accepted obligations, never new-policy applications.
async function historical(who:number,invoiceRequired:boolean) {
 const [insert]=await c.query<mysql.ResultSetHeader>("INSERT INTO opc_withdrawals(module_id,project_id,account_id,user_id,amount,request_key,request_hash,receiver_name,bank_name,bank_account) VALUES(?,1,1,?,600,?,REPEAT('a',64),'历史验收','隔离银行','TEST')",[scope.moduleId,who,crypto.randomUUID()]);
 const id=String(insert.insertId),quote={policyVersion:'2026-10-13-v1',appliedDay:'2026-10-13',feeAmount:'6.0000',netAmount:'594.0000',invoiceRequired};
 await c.query("INSERT INTO opc_withdrawal_terms(withdrawal_id,user_id,applied_day,policy_version,applicant_role,fee_amount,net_amount,tier,review_deadline,settlement_deadline,settlement_month,invoice_required,terms_json) VALUES(?,?,'2026-10-13','2026-10-13-v1',?,6,594,'large','2026-11-03','2026-11-30','2026-11',?,?)",[id,who,actors[who-1].role,invoiceRequired,JSON.stringify(quote)]);
 return {id,quote};
}
it('requires invoices only for large leader applications and protects all attachment actions', async () => {
  const entry = await historical(3, true),
    endpoint = '/withdrawals/' + entry.id;
  expect(entry.quote.invoiceRequired).toBe(true);
  expect((await post(1, endpoint + '/review', { ...scope, action: 'approve' })).status).toBe(200);
  expect(
    (
      await post(1, endpoint + '/pay', {
        ...scope,
        paidOn: entry.quote.appliedDay,
        acknowledged: true,
        policyVersion: entry.quote.policyVersion,
        netAmount: entry.quote.netAmount,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post(1, endpoint + '/invoice-instructions', {
        ...scope,
        instructions: '隔离测试：按真实业务填写票面资料，不是正式开票信息',
      })
    ).status,
  ).toBe(200);
  const attach = (who: number, version: number, bytes = Buffer.from('%PDF-1.4\nsynthetic only')) => {
    const r = request(app)
      .post(path + endpoint + '/invoice')
      .set(headers[String(who)]);
    for (const [k, v] of Object.entries(scope)) r.field(k, v);
    return r.field('expectedVersion', String(version)).attach('proof', bytes, 'invoice.pdf');
  };
  expect((await attach(7, 0)).status).toBe(403);
  expect((await attach(3, 0, Buffer.from('bad file'))).status).toBe(422);
  expect((await attach(3, 0)).status).toBe(200);
  expect((await attach(3, 0)).status).toBe(200);
  expect((await get(7, endpoint + '/invoice')).status).toBe(403);
  expect((await get(4, endpoint + '/invoice')).status).toBe(403);
  expect((await get(3, endpoint + '/invoice')).status).toBe(200);
  expect((await post(3, endpoint + '/invoice-review', { ...scope, expectedVersion: 1, action: 'accept' })).status).toBe(
    403,
  );
  expect(
    (
      await post(1, endpoint + '/invoice-review', {
        ...scope,
        expectedVersion: 1,
        action: 'reject',
        reason: '请补齐真实开票信息',
      })
    ).status,
  ).toBe(200);
  expect((await attach(3, 1, Buffer.from('%PDF-1.4\nnew synthetic only'))).status).toBe(200);
  expect((await post(1, endpoint + '/invoice-review', { ...scope, expectedVersion: 1, action: 'accept' })).status).toBe(
    409,
  );
  expect((await post(1, endpoint + '/invoice-review', { ...scope, expectedVersion: 2, action: 'accept' })).status).toBe(
    200,
  );
  expect(
    (
      await post(1, endpoint + '/pay', {
        ...scope,
        paidOn: entry.quote.appliedDay,
        acknowledged: true,
        requestKey: crypto.randomUUID(),
        policyVersion: entry.quote.policyVersion,
        netAmount: entry.quote.netAmount,
      })
    ).status,
  ).toBe(200);
  expect((await q('SELECT COUNT(*) n FROM opc_withdrawal_invoices WHERE withdrawal_id=?', [entry.id]))[0].n).toBe(2);
});
it('large creators need no invoice and small leaders also stay on the small schedule', async () => {
  const large = await historical(7, false),
    small = await apply(6, '500');
  expect(large.quote).toMatchObject({ invoiceRequired: false, policyVersion:'2026-10-13-v1' });
  expect(small.quote).toMatchObject({ invoiceRequired: false, tier: 'small' });
  for (const id of [large.id, small.id]) {
    const sheet = (await get(1, '/payment-sheet')).body.data;
    expect(sheet.find((r: { id: string }) => r.id === id).invoiceRequired).toBe(false);
  }
  for (const entry of [large, small]) {
    expect((await post(1, '/withdrawals/' + entry.id + '/review', { ...scope, action: 'approve' })).status).toBe(200);
    expect(
      (
        await post(1, '/withdrawals/' + entry.id + '/pay', {
          ...scope,
          paidOn: entry.quote.appliedDay,
          acknowledged: true,
          requestKey: crypto.randomUUID(),
          policyVersion: entry.quote.policyVersion,
          netAmount: entry.quote.netAmount,
        })
      ).status,
    ).toBe(200);
  }
});
it('keeps historical withdrawal terms and rejects stale policy after deactivation', async () => {
  const quote = (await get(8, '/withdrawal-quote', { ...scope, amount: '10' })).body.data;
  process.env.OPC_WITHDRAWAL_POLICY_ENABLED = '0';
  expect(
    (
      await post(8, '/withdrawals', {
        ...scope,
        amount: '10',
        requestKey: crypto.randomUUID(),
        policyVersion: quote.policyVersion,
        quoteToken: quote.quoteToken,
      })
    ).status,
  ).toBe(409);
  const old = await post(8, '/withdrawals', { ...scope, amount: '1', requestKey: crypto.randomUUID() });
  expect(old.status).toBe(201);
  process.env.OPC_WITHDRAWAL_POLICY_ENABLED = '1';
  expect(
    (
      await post(1, '/withdrawals/' + old.body.data.id + '/pay', {
        ...scope,
        paidOn: quote.appliedDay,
        acknowledged: true,
        requestKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  const record = (await get(8, '')).body.data.withdrawals[0];
  expect(record).toMatchObject({ feeAmount: '0.0000', netAmount: '1.0000', policyVersion: null });
});
it('replays the original accepted request across midnight but requires a fresh quote for a new day', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-10-13T15:59:00Z'));
    const quote = await finance.withdrawalQuote(actors[8], scope, '10'),
      requestKey = crypto.randomUUID(),
      input = { amount: '10', policyVersion: quote.policyVersion, quoteToken: quote.quoteToken };
    const first = await finance.applyWithdrawal(actors[8], scope, requestKey, input);
    vi.setSystemTime(new Date('2026-10-13T16:01:00Z'));
    expect(await finance.applyWithdrawal(actors[8], scope, requestKey, input)).toEqual(first);
    await expect(finance.applyWithdrawal(actors[8], scope, crypto.randomUUID(), input)).rejects.toThrow('重新确认');
    const next = await finance.withdrawalQuote(actors[8], scope, '10');
    expect(next.appliedDay).toBe('2026-10-14');
    expect(
      (await finance.applyWithdrawal(actors[8], scope, crypto.randomUUID(), { ...input, quoteToken: next.quoteToken }))
        .id,
    ).not.toBe(first.id);
  } finally {
    vi.useRealTimers();
  }
});
it('rolls back both balance reservation and the daily slot when writing the terms fails', async () => {
  const quote = (await get(10, '/withdrawal-quote', { ...scope, amount: '10' })).body.data,
    body = {
      ...scope,
      amount: '10',
      requestKey: crypto.randomUUID(),
      policyVersion: quote.policyVersion,
      quoteToken: quote.quoteToken,
    };
  await c.query(
    'ALTER TABLE opc_withdrawal_terms ADD CONSTRAINT isolated_fail_terms CHECK(user_id<>10)',
  );
  try {
    expect((await post(10, '/withdrawals', body)).status).toBe(500);
  } finally {
    await c.query('ALTER TABLE opc_withdrawal_terms DROP CHECK isolated_fail_terms');
  }
  expect((await q('SELECT COUNT(*) n FROM opc_withdrawals WHERE user_id=10'))[0].n).toBe(0);
  expect((await get(10, '')).body.data.balance.available).toBe('2000.0000');
  const applied = await post(10, '/withdrawals', body);
  expect(applied.status).toBe(201);
  expect(
    (
      await post(1, '/withdrawals/' + applied.body.data.id + '/review', {
        ...scope,
        action: 'reject',
        reason: '隔离拒绝验收',
      })
    ).status,
  ).toBe(200);
  expect((await get(10, '')).body.data.balance.available).toBe('2000.0000');
  expect((await get(10, '/withdrawal-quote', { ...scope, amount: '10' })).status).toBe(200);
});
it('filters overdue requests before pagination without broadening access', async () => {
  const beforeCount=(await get(1,'',{...scope,attention:'overdue'})).body.data.total;
  const entry = await apply(11, '10');
  // Synthetic overdue fixture, never applied to business records.
  await c.query(
    "UPDATE opc_withdrawal_terms SET review_deadline='2026-01-01',settlement_deadline='2026-01-01' WHERE withdrawal_id=?",
    [entry.id],
  );
  const queue = (await get(1, '', { ...scope, attention: 'overdue' })).body.data;
  expect(queue.total).toBe(beforeCount+1);
  expect(queue.withdrawals[0]).toMatchObject({ id: entry.id, attention: 'overdue' });
  expect((await get(12, '', { ...scope, attention: 'overdue' })).body.data.total).toBe(0);
  expect((await get(4, '', { ...scope, attention: 'overdue' })).status).toBe(403);
});


it('shares accepted mini requests, Web financial decisions and payment corrections without leaking another user', async () => {
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions');
  const { signToken } = await import('../../src/auth/jwt');
  const { wechatClientId } = await import('../../src/wechat/context');
  const identity = {appId:'wx0000000000000001',openId:'isolated_withdrawal_user12'};
  const session = await issueRefreshSession('12',{type:'mini',id:wechatClientId(identity)});
  const token = await signToken({...actors[11],id:'12',sessionId:session.familyId});
  const mini = (method: string, suffix: string, data: object) => {
    const raw = JSON.stringify({...identity,token,method,path:'/core/finance'+suffix,data});
    const time=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex');
    return request(app).post('/api/v1/mini/bridge').set({
      'Content-Type':'application/json','X-Bridge-Time':time,'X-Bridge-Nonce':nonce,
      'X-Bridge-Signature':crypto.createHmac('sha256',process.env.WECHAT_BRIDGE_SECRET!).update(`${time}\n${nonce}\n${raw}`).digest('hex'),
    }).send(raw);
  };
  const before = (await get(12,'')).body.data.balance;
  const quoted=await mini('GET','/withdrawal-quote',{...scope,amount:'10'});
  expect(quoted.status,quoted.text).toBe(200);
  const quote=quoted.body.data;
  const body={...scope,amount:'10',requestKey:crypto.randomUUID(),policyVersion:quote.policyVersion,quoteToken:quote.quoteToken,receiverName:'隔离',bankName:'测试',bankAccount:'TEST'};
  const created=await mini('POST','/withdrawals',body);
  expect(created.status,created.text).toBe(201);const id=created.body.data.id;
  const check=async(status:string)=>{const r=await mini('GET','',scope);expect(r.status,r.text).toBe(200);expect(r.body.data.withdrawals.find((w:any)=>w.id===id).status).toBe(status);};
  await check('pending');
  expect((await post(1,'/withdrawals/'+id+'/review',{...scope,action:'approve'})).status).toBe(200);
  await check('approved');
  expect((await post(1,'/withdrawals/'+id+'/pay',{...scope,paidOn:quote.appliedDay,acknowledged:true,requestKey:crypto.randomUUID(),policyVersion:quote.policyVersion,netAmount:quote.netAmount})).status).toBe(200);
  await check('paid');
  const paid=(await mini('GET','',scope)).body.data;
  expect(paid.balance.paid).toBe('9.9000');expect(paid.withdrawalPolicy.remainingAmount).toBe('90.0000');
  const version=paid.withdrawals.find((w:any)=>w.id===id).paymentVersion;
  expect((await post(1,'/withdrawals/'+id+'/correct',{...scope,expectedVersion:version,requestKey:crypto.randomUUID(),action:'void',reason:'隔离状态回归，无真实付款'})).status).toBe(200);
  await check('approved');
  expect((await mini('GET','',{...scope,projectId:'999'})).status).toBe(403);
  expect((await mini('POST','/withdrawals/'+id+'/review',{...scope,action:'approve'})).status).toBe(403);
  expect((await get(6,'')).body.data.withdrawals.some((w:any)=>w.id===id)).toBe(false);
  const again=await apply(12,'0.01');
  expect((await post(1,'/withdrawals/'+again.id+'/review',{...scope,action:'reject',reason:'请核对收款资料'})).status).toBe(200);
  const rejected=(await mini('GET','',scope)).body.data.withdrawals.find((w:any)=>w.id===again.id);
  expect(rejected).toMatchObject({status:'rejected',remark:'请核对收款资料'});
  // A mini token cannot claim to be a Web client to bypass transport authentication.
  const forged = await request(app).post(path+'/withdrawals').set('Authorization','Bearer '+token)
    .set('X-Client-Id',wechatClientId(identity)).send(body);
  expect(forged.status).toBe(401);
});

it('counts gross after a role change and never resets quota on a rejected duplicate',async()=>{
 const who=10,u=actors[9],quote=await finance.withdrawalQuote(u,scope,'10');
 await c.query("UPDATE users SET role='leader' WHERE id=10");
 try {
  await expect(finance.applyWithdrawal(u,scope,crypto.randomUUID(),{amount:'10',policyVersion:quote.policyVersion,quoteToken:quote.quoteToken})).rejects.toThrow('重新确认');
  const leader={...u,role:'leader'} as AuthUser;
  const q2=await finance.withdrawalQuote(leader,scope,'500');
  const entry=await finance.applyWithdrawal(leader,scope,crypto.randomUUID(),{amount:'500',policyVersion:q2.policyVersion,quoteToken:q2.quoteToken});
  expect((await finance.financeOverview(leader,second)).withdrawalPolicy).toMatchObject({todayAmount:'500.0000',remainingAmount:'0.0000'});
  await c.query("UPDATE users SET role='creator' WHERE id=10");
  expect((await finance.financeOverview(u,scope)).withdrawalPolicy.remainingAmount).toBe('0.0000');
  await finance.reviewWithdrawal(actors[0],scope,entry.id,'reject','隔离额度验收');
  expect((await finance.financeOverview(u,scope)).withdrawalPolicy.remainingAmount).toBe('100.0000');
 } finally {await c.query("UPDATE users SET role='creator' WHERE id=10");}
});
it('releasing a prior-day reservation does not add extra allowance today',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 try {
  vi.setSystemTime(new Date('2026-10-25T15:59:00Z'));
  const u=actors[8],quote=await finance.withdrawalQuote(u,scope,'100');
  const entry=await finance.applyWithdrawal(u,scope,crypto.randomUUID(),{amount:'100',policyVersion:quote.policyVersion,quoteToken:quote.quoteToken});
  vi.setSystemTime(new Date('2026-10-25T16:01:00Z'));
  expect((await finance.financeOverview(u,scope)).withdrawalPolicy.remainingAmount).toBe('100.0000');
  await finance.reviewWithdrawal(u,scope,entry.id,'cancel','');
  expect((await finance.financeOverview(u,scope)).withdrawalPolicy.remainingAmount).toBe('100.0000');
 } finally {vi.useRealTimers();}
});
