import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import mysql, { type Connection } from 'mysql2/promise';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as XLSX from 'xlsx';
import Queue from 'bull';
import type { AuthUser } from '../../src/types';
import { runOpcMigrations } from '../../scripts/opcMigrations';

// 只模拟上游关键词创建投递；报告导入使用真实公共 Bull 队列及独立 Worker 进程。
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'upstream-simulated' })) }));
let mysqlContainer: StartedMySqlContainer, redis: StartedTestContainer, c: Connection, rowLock: Connection;
let pool: typeof import('../../src/db').db;
let facts: typeof import('../../src/modules/zhihu/attribution/facts');
let statements: typeof import('../../src/modules/zhihu/attribution/statements');
let deliveryQueue: Queue.Queue | undefined;
const processes: ChildProcess[] = [];
const user = (sub: string, role: AuthUser['role']): AuthUser => ({
  sub,
  role,
  username: role,
  displayName: role,
  parentId: role === 'creator' ? '2' : null,
  jti: 'recovery-test',
});
const admin = user('1', 'admin'),
  leader = user('2', 'leader'),
  creator = user('3', 'creator');
const scope = { projectId: '1', accountId: '' };
const key = () => crypto.randomUUID();
let batchId = '',
  jobId = '',
  date = '',
  worker: ChildProcess;
const childLogs: string[] = [];

async function spawnWorker() {
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href,
      path.resolve('tests/attribution/support/recovery-worker.ts'),
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ATTRIBUTION_RECOVERY_TEST: '1',
        QUEUE_DRIVER: 'bull',
        REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      },
    },
  );
  processes.push(child);
  let ready = false;
  child.on('message', (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message) {
      if (message.type === 'ready') ready = true;
      if (message.type === 'error') childLogs.push(JSON.stringify(message));
    }
  });
  child.stdout?.on('data', (data: Buffer) => childLogs.push(data.toString()));
  child.stderr?.on('data', (data: Buffer) => childLogs.push(data.toString()));
  await vi.waitFor(
    () => {
      if (child.exitCode !== null) throw new Error(`Worker 启动失败：${childLogs.join('')}`);
      expect(ready).toBe(true);
    },
    { timeout: 10000, interval: 50 },
  );
  return child;
}

async function killWorker(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}
async function job() {
  const [rows] = await c.query<mysql.RowDataPacket[]>('SELECT * FROM zh_processing_jobs WHERE id=?', [jobId]);
  return rows[0];
}
async function rowCounts() {
  const [rows] = await c.query<mysql.RowDataPacket[]>(
    'SELECT processing_status status,COUNT(*) count FROM zh_import_rows WHERE batch_id=? GROUP BY processing_status',
    [batchId],
  );
  return Object.fromEntries(rows.map((r) => [String(r.status), Number(r.count)]));
}
async function waitDone() {
  await vi.waitFor(
    async () => {
      if (worker.exitCode !== null) throw new Error(`Worker 提前退出：${childLogs.join('')}`);
      expect((await job()).status).toBe('done');
    },
    { timeout: 30000, interval: 100 },
  );
}
async function amountSnapshot() {
  const [entries] = await c.query<mysql.RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) id,CAST(amount AS CHAR) amount,status,input_hash FROM zh_statement_entries ORDER BY id',
  );
  return entries;
}

beforeAll(async () => {
  mysqlContainer = await new MySqlContainer('mysql:8.0')
    .withDatabase('attribution_recovery_test')
    .withUsername('test')
    .withUserPassword('isolated_test')
    .start();
  redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withAutoRemove(false)
    .withCommand(['redis-server', '--save', '', '--appendonly', 'no'])
    .start();
  const target = {
    host: mysqlContainer.getHost(),
    port: mysqlContainer.getPort(),
    database: mysqlContainer.getDatabase(),
    user: mysqlContainer.getUsername(),
    password: mysqlContainer.getUserPassword(),
  };
  Object.assign(process.env, {
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    OPC_MODULES: 'zhihu',
    QUEUE_DRIVER: 'bull',
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  rowLock = await mysql.createConnection(target);
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(1,'admin','unused','admin','管理员',NULL),(2,'leader','unused','leader','团长',NULL),(3,'creator','unused','creator','达人',2)",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3)');
  const [accounts] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
  scope.accountId = String(accounts[0].id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'ch1',1,'恢复渠道')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task1','恢复任务',NOW())");
  const resources = await import('../../src/modules/zhihu/attribution/resources');
  const pricing = await import('../../src/modules/zhihu/attribution/pricing');
  const cutover = await import('../../src/modules/zhihu/attribution/cutover');
  facts = await import('../../src/modules/zhihu/attribution/facts');
  statements = await import('../../src/modules/zhihu/attribution/statements');
  pool = (await import('../../src/db')).db;
  date = (await import('../../src/modules/zhihu/attribution/domain')).businessDay();
  await cutover.configureRoute(admin, scope, {
    from: date,
    mode: 'trial',
    reason: '隔离恢复测试',
    sampleVerified: false,
  });
  const mapping = await resources.createMapping(admin, scope, key(), { channelId: '1', name: '恢复渠道', from: date });
  const word = await resources.createKeyword(admin, scope, key(), {
    keyword: '恢复独占词',
    taskId: '1',
    mappingId: mapping.id,
    landingUrl: 'https://example.com/work',
    popularizeType: 1,
  });
  await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='mock' WHERE id=?", [word.planId]);
  await resources.synchronizeKeywords();
  const binding = await resources.claim(leader, scope, word.id, key());
  await resources.changeBinding(leader, scope, binding.id, key(), { action: 'assign', executorId: '3' });
  await resources.changeBinding(creator, scope, binding.id, key(), { action: 'activate' });
  for (const [payer, payeeId, unitPrice] of [
    [admin, '2', '15'],
    [leader, '3', '13'],
  ] as const) {
    const price = await pricing.draftPrice(payer, scope, key(), {
      taskId: '1',
      payeeId,
      unitPrice,
      from: date,
      reason: '恢复测试报价',
    });
    await pricing.publishPrice(payer, scope, price.id, key());
  }
  const evidence = await statements.submitEvidence(creator, scope, key(), {
    bindingId: binding.id,
    url: 'https://example.com/work',
    description: '模拟作品证据',
  });
  await statements.reviewEvidence(leader, scope, evidence.id, key(), true, '仅隔离核验');
  await cutover.configureRoute(admin, scope, {
    from: date,
    mode: 'enabled',
    reason: '隔离对账验证',
    sampleVerified: true,
  });
}, 90000);

afterAll(async () => {
  for (const child of processes) await killWorker(child);
  await rowLock?.rollback();
  await deliveryQueue?.close();
  await pool?.end();
  await c?.end();
  await rowLock?.end();
  await redis?.stop({ remove: true, removeVolumes: true });
  await mysqlContainer?.stop({ remove: true, removeVolumes: true });
});

describe('真实 Bull 队列与进程故障恢复', () => {
  it('Redis 停机仍可提交报告；处理到第二行前杀死 Worker，重启无持久化 Redis 后从数据库补投', async () => {
    // 只停止本测试创建且保留容器 ID 的 Redis，不触碰外部服务。
    await promisify(execFile)('docker', ['stop', '--time', '0', redis.getId()], { windowsHide: true, timeout: 30000 });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['日期时间', '渠道名称', '关键词', '推广任务', '风险判定', '搜索量', '订单量', '搜索转化率（单位%）'],
        ...Array.from({ length: 205 }, () => [date, '恢复渠道', '恢复独占词', '恢复任务', null, 1000, 100, 10]),
      ]),
      '恢复样例',
    );
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const batch = await facts.previewImport(
      admin,
      scope,
      {
        originalname: '恢复.xlsx',
        buffer,
        size: buffer.length,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      'combined',
    );
    batchId = batch.id;
    const detail = await facts.importDetail(admin, scope, batchId, 1, 25);
    await facts.commitImport(admin, scope, batchId, key(), detail.preview_hash);
    const [jobs] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM zh_processing_jobs WHERE batch_id=?', [
      batchId,
    ]);
    jobId = String(jobs[0].id);
    expect((await job()).status).toBe('pending');
    expect(await rowCounts()).toEqual({ pending: 205 });
    await redis.restart();
    const [rows] = await c.query<mysql.RowDataPacket[]>(
      'SELECT id FROM zh_import_rows WHERE batch_id=? ORDER BY id LIMIT 2',
      [batchId],
    );
    await rowLock.beginTransaction();
    await rowLock.query('SELECT id FROM zh_import_rows WHERE id=? FOR UPDATE', [rows[1].id]);
    worker = await spawnWorker();
    worker.send('start');
    await vi.waitFor(
      async () => {
        expect((await job()).status).toBe('running');
        expect(await rowCounts()).toEqual({ processed: 1, pending: 204 });
      },
      { timeout: 15000, interval: 100 },
    );
    await killWorker(worker);
    await rowLock.rollback();
    expect((await job()).status).toBe('running');
    expect(await rowCounts()).toEqual({ processed: 1, pending: 204 });
    await redis.restart();
    expect((await redis.exec(['redis-cli', 'DBSIZE'])).output.trim()).toBe('0');
    // 提前推进该隔离任务的租约到期时刻，不修改生产租约配置。
    await c.query('UPDATE zh_processing_jobs SET lease_until=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?', [jobId]);
    worker = await spawnWorker();
    worker.send('start');
    await waitDone();
    expect(Number((await job()).attempts)).toBe(3);
    expect(await rowCounts()).toEqual({ processed: 1, duplicate: 204 });
    const result = await facts.listAttributions(admin, scope, 1, 25);
    expect(result.total).toBe(1);
    const factId = String(result.list[0].id);
    expect((await facts.trace(admin, scope, factId)).revisions).toHaveLength(1);
    for (const payer of [leader, admin]) {
      const draft = (await statements.previewStatement(payer, scope, key(), factId)).entries[0];
      const entry = (await statements.listStatements(payer, scope, 1, 25)).list.find((e) => e.id === draft.id)!;
      await statements.confirmStatement(payer, scope, draft.id, key(), String(entry.input_hash));
    }
    expect((await amountSnapshot()).map((e) => e.amount).sort()).toEqual(['1300.0000', '1500.0000']);
  }, 90000);

  it('账号停用和重复投递不重复事实、应付或确认金额', async () => {
    // 暂停定时补投，避免测试设置停用状态时与下一次调度竞争；Bull 消费仍在运行。
    const paused = once(worker, 'message', { signal: AbortSignal.timeout(5000) });
    worker.send('pause-recovery');
    expect((await paused)[0]).toEqual({ type: 'paused' });
    // Docker 重启后映射端口可能变化；故障注入连接必须使用当前容器地址。
    deliveryQueue = new Queue('opc-jobs', `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`);
    const before = await amountSnapshot();
    await facts.requeueImport(admin, scope, batchId, key());
    await c.query("UPDATE integration_accounts SET status='disabled' WHERE id=?", [scope.accountId]);
    const payload = { ...scope, moduleId: 'zhihu', jobId };
    const deliveries = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        deliveryQueue!.add('zhihu.exclusive-import', payload, {
          jobId: `disabled-${index}`,
          attempts: 1,
          removeOnFail: false,
        }),
      ),
    );
    for (const delivery of deliveries) {
      await vi.waitFor(async () => expect(await delivery.getState()).toBe('failed'), { timeout: 10000, interval: 50 });
    }
    expect((await job()).status).toBe('pending');
    expect(await amountSnapshot()).toEqual(before);
    await c.query("UPDATE integration_accounts SET status='active' WHERE id=?", [scope.accountId]);
    worker.send('recover');
    await waitDone();
    const repeated = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        deliveryQueue!.add('zhihu.exclusive-import', payload, {
          jobId: `repeated-${index}`,
          attempts: 1,
          removeOnComplete: false,
        }),
      ),
    );
    for (const delivery of repeated) {
      await vi.waitFor(async () => expect(await delivery.getState()).toBe('completed'), {
        timeout: 10000,
        interval: 50,
      });
    }
    expect(await amountSnapshot()).toEqual(before);
    expect(await rowCounts()).toEqual({ processed: 1, duplicate: 204 });
    expect((await facts.listAttributions(admin, scope, 1, 25)).total).toBe(1);
    const [legacy] = await c.query<mysql.RowDataPacket[]>('SELECT COUNT(*) count FROM earnings');
    expect(Number(legacy[0].count)).toBe(0);
  }, 30000);
});
