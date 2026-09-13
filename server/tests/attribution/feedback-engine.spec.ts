import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import type { ReportKind } from '../../src/modules/zhihu/attribution/report';
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'test' })) }));

let container: StartedMySqlContainer, c: Connection;
let pool: typeof import('../../src/db').db;
let facts: typeof import('../../src/modules/zhihu/attribution/facts');
let statements: typeof import('../../src/modules/zhihu/attribution/statements');
const user = (sub: string, role: AuthUser['role']): AuthUser => ({
  sub,
  role,
  parentId: role === 'creator' ? '2' : null,
  username: role,
  displayName: role,
  jti: role,
});
const admin = user('1', 'admin'),
  leader = user('2', 'leader'),
  creator = user('3', 'creator');
const scope = { accountId: '', projectId: '1' };
const key = () => crypto.randomUUID();
const keyword = '真实表头专用词';
const headers = ['日期时间', '渠道名称', '关键词', '推广任务', '风险判定', '搜索量', '订单量', '搜索转化率（单位%）'];
let date = '',
  factId = '',
  orderCandidate = '';
function file(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '反馈');
  const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  return {
    originalname: '反馈.xlsx',
    size: buffer.length,
    buffer,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
const feedback = (orders: number, risk: string | null = null, searches = 1000) => [
  headers,
  [date, '渠道甲', keyword, 'KOC—会员订单', risk, searches, orders, 99],
];
async function upload(rows: unknown[][], kind: ReportKind = 'combined') {
  const batch = await facts.previewImport(admin, scope, file(rows), kind);
  const detail = await facts.importDetail(admin, scope, batch.id, 1, 25);
  await facts.commitImport(admin, scope, batch.id, key(), detail.preview_hash);
  await facts.processBatch(admin, scope, batch.id);
  return facts.importDetail(admin, scope, batch.id, 1, 25);
}
async function current() {
  return (await facts.listAttributions(admin, scope, 1, 25)).list[0] as Record<string, unknown>;
}
async function pending(batchId: string) {
  const [rows] = await c.query<mysql.RowDataPacket[]>(
    "SELECT v.id FROM zh_metric_revisions v JOIN zh_import_rows r ON r.id=v.source_row_id WHERE r.batch_id=? AND v.status='pending'",
    [batchId],
  );
  expect(rows).toHaveLength(1);
  return String(rows[0].id);
}
async function accept(id: string) {
  await facts.acceptRevision(admin, scope, id, key(), String((await current()).revision_id), '核对合成来源修订');
}
async function entries(status: string) {
  return (await statements.listStatements(admin, scope, 1, 25)).list.filter((e) => e.status === status);
}
async function confirmDrafts() {
  const list = await entries('draft');
  for (const role of [leader, admin]) {
    const entry = list.find((e) => e.relation_type === (role === leader ? 'leader_creator' : 'agency_leader'));
    expect(entry).toBeDefined();
    await statements.confirmStatement(role, scope, String(entry!.id), key(), String(entry!.input_hash));
  }
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('feedback_test')
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
    OPC_MODULES: 'zhihu',
  });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(1,'admin','unused','admin','管理员',NULL),(2,'leader','unused','leader','团长',NULL),(3,'creator','unused','creator','达人',2)",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3)');
  const [accounts] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
  scope.accountId = String(accounts[0].id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'ch1',1,'渠道甲')");
  // 表内名称指向另一个任务时，也必须使用关键词已绑定的任务 ID。
  await c.query(
    "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'t1','推广任务一',NOW()),(2,1,'t2','KOC—会员订单',NOW())",
  );
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
    reason: '真实表头合成样例',
    sampleVerified: false,
  });
  const mapping = await resources.createMapping(admin, scope, key(), { channelId: '1', name: '渠道甲', from: date });
  const word = await resources.createKeyword(admin, scope, key(), {
    keyword,
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
      reason: '样例报价',
    });
    await pricing.publishPrice(payer, scope, price.id, key());
  }
  const evidence = await statements.submitEvidence(creator, scope, key(), {
    bindingId: binding.id,
    url: 'https://example.com/work',
    description: '合成作品核验',
  });
  await statements.reviewEvidence(leader, scope, evidence.id, key(), true, '测试核验');
  await cutover.configureRoute(admin, scope, {
    from: date,
    mode: 'enabled',
    reason: '仅隔离库验证',
    sampleVerified: true,
  });
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});

describe('真实表头的归因、修订与对账', () => {
  it('文件未通过异步安全校验时，不保存批次、原始行或待办', async () => {
    const source = file(feedback(100));
    const book = XLSX.read(source.buffer, { type: 'buffer' });
    book.Sheets['反馈'].G2.f = '100';
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const counts = async () =>
      (
        await c.query<mysql.RowDataPacket[]>(
          'SELECT (SELECT COUNT(*) FROM zh_import_batches) batches,(SELECT COUNT(*) FROM zh_import_rows) source_rows,(SELECT COUNT(*) FROM zh_processing_jobs) jobs',
        )
      )[0];
    const before = await counts();
    await expect(
      facts.previewImport(admin, scope, { ...source, buffer, size: buffer.length }, 'combined'),
    ).rejects.toThrow('上传文件不符合要求');
    expect(await counts()).toEqual(before);
  });
  it('旧模板预览必须重新上传；新版预览保留旧批次和原始行', async () => {
    const source = file(feedback(999));
    const previous = await facts.previewImport(admin, scope, source, 'combined');
    await c.query("UPDATE zh_import_batches SET template_version='zhihu-v2' WHERE id=?", [previous.id]);
    const before = await facts.importDetail(admin, scope, previous.id, 1, 25);
    await expect(facts.commitImport(admin, scope, previous.id, key(), before.preview_hash)).rejects.toThrow(
      '报告解析规则已更新',
    );
    const current = await facts.previewImport(admin, scope, source, 'combined');
    expect(current.id).not.toBe(previous.id);
    expect(await facts.importDetail(admin, scope, previous.id, 1, 25)).toEqual(before);
    expect((await facts.importDetail(admin, scope, current.id, 1, 25)).template_version).toBe('zhihu-v3');
  });
  it('无收益报告生成两层应付；任务名和转化率不改变计费，原字段可追溯', async () => {
    const detail = await upload(feedback(100));
    expect(detail.template_version).toBe('zhihu-v3');
    const item = await current();
    factId = String(item.id);
    expect(item).toMatchObject({ orders: '100', revenue: null, agencyMargin: null, reason_code: null });
    expect((item.obligations as { amount: string }[]).map((o) => o.amount)).toEqual(['1500.0000', '1300.0000']);
    const leaderView = (await facts.listAttributions(leader, scope, 1, 25)).list[0];
    expect(leaderView).toMatchObject({ teamMargin: '200.0000' });
    const own = (await facts.listAttributions(creator, scope, 1, 25)).list[0];
    expect(own).not.toHaveProperty('revenue');
    expect(own).not.toHaveProperty('agencyMargin');
    const trace = await facts.trace(admin, scope, factId);
    expect(trace.revisions[0].normalized_json).toMatchObject({
      promotionTask: 'KOC—会员订单',
      riskAssessment: null,
      conversionRateRaw: 99,
    });
    await statements.previewStatement(leader, scope, key(), factId);
    await statements.previewStatement(admin, scope, key(), factId);
    await confirmDrafts();
    expect(await entries('confirmed')).toHaveLength(2);
    const duplicate = await facts.previewImport(
      admin,
      scope,
      { ...file(feedback(100)), originalname: '换名.xlsx' },
      'combined',
    );
    expect(duplicate).toEqual({ id: String(detail.id), duplicate: true });
  });
  it('含收益旧模板仍兼容；无收益的订单修订及重建候选不沿用旧收益', async () => {
    await upload(
      [
        ['日期', '渠道名称', '关键词', '订单', '收益'],
        [date, '渠道甲', keyword, 100, 2000],
      ],
      'order',
    );
    expect(await current()).toMatchObject({ agencyMargin: '500.0000', revenue: '2000.0000' });
    const order = await upload(feedback(90), 'order');
    orderCandidate = await pending(String(order.id));
    const search = await upload(
      [
        ['日期', '渠道名称', '关键词', '搜索量'],
        [date, '渠道甲', keyword, 1001],
      ],
      'search',
    );
    await accept(await pending(String(search.id)));
    const rebased = await facts.rebaseRevision(
      admin,
      scope,
      orderCandidate,
      key(),
      String((await current()).revision_id),
      '保留搜索修订并清除过期收益',
    );
    await accept(rebased.id);
    expect(await current()).toMatchObject({ orders: '90', search: '1001', revenue: null, agencyMargin: null });
    expect((await entries('draft')).map((e) => e.amount).sort()).toEqual(['-130.0000', '-150.0000']);
    expect((await entries('confirmed')).map((e) => e.amount).sort()).toEqual(['1300.0000', '1500.0000']);
  });
  it('非空风险即使订单同值也形成修订；接受风险来源后不能生成应付或冒充有效订单', async () => {
    const low = (await entries('draft')).find((e) => e.relation_type === 'leader_creator')!;
    const risk = await upload(feedback(90, '平台待核实', 1001));
    await expect(
      statements.confirmStatement(leader, scope, String(low.id), key(), String(low.input_hash)),
    ).rejects.toThrow('来源修订');
    await accept(await pending(String(risk.id)));
    expect(await current()).toMatchObject({
      orders: '90',
      reason_code: 'RISK_REVIEW_REQUIRED',
      obligations: [],
      agencyMargin: null,
    });
    await expect(statements.previewStatement(admin, scope, key(), factId)).rejects.toThrow('来源未完成');
    await expect(
      statements.confirmStatement(leader, scope, String(low.id), key(), String(low.input_hash)),
    ).rejects.toThrow('来源已修订');
    const riskException = (await facts.listExceptions(admin, scope, 1, 25)).list.find(
      (e) => e.reason_code === 'RISK_REVIEW_REQUIRED',
    )!;
    await expect(facts.retryException(admin, scope, String(riskException.id), key(), '尝试重试')).rejects.toThrow(
      '不能通过重试解除',
    );
    const { attributionDataProvider } = await import('../../src/modules/zhihu/attribution/provider');
    const summary = await attributionDataProvider.summary({ ...scope, from: date, to: date }, admin);
    expect(summary.metrics.map((m) => m.value)).toEqual([null, '1001']);
  });
  it('无风险列和搜索分报空值均不解除风险；上游空风险更正须确认后恢复差额', async () => {
    await upload(
      [
        ['日期', '渠道名称', '关键词', '订单量'],
        [date, '渠道甲', keyword, 90],
      ],
      'order',
    );
    await upload(feedback(90, null, 1001), 'search');
    expect((await current()).reason_code).toBe('RISK_REVIEW_REQUIRED');
    const corrected = await upload(feedback(90, null, 1001));
    expect((await current()).reason_code).toBe('RISK_REVIEW_REQUIRED');
    await accept(await pending(String(corrected.id)));
    expect(await current()).toMatchObject({ reason_code: null, orders: '90', revenue: null });
    await confirmDrafts();
    expect((await entries('confirmed')).map((e) => e.amount).sort()).toEqual([
      '-130.0000',
      '-150.0000',
      '1300.0000',
      '1500.0000',
    ]);
    expect((await facts.listExceptions(admin, scope, 1, 25)).list.filter((e) => e.status === 'open')).toHaveLength(0);
  });
});
