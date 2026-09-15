import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'test' })) }));
let container: StartedMySqlContainer, c: Connection;
let resource: typeof import('../../src/modules/zhihu/attribution/resources');
let pool: typeof import('../../src/db').db;
const user = (id: string, role: AuthUser['role'], parentId: string | null = null): AuthUser => ({
  sub: id,
  role,
  parentId,
  username: `u${id}`,
  displayName: `用户${id}`,
  jti: `test${id}`,
});
const admin = user('1', 'admin'),
  leader = user('2', 'leader'),
  creator = user('3', 'creator', '2'),
  direct = user('4', 'creator'),
  outsider = user('5', 'leader');
let scope = { projectId: '1', accountId: '' },
  mappingId = '',
  wordId = '',
  bindingId = '';
let factId = '',
  pendingRevision = '',
  originalRevision = '';
const key = () => crypto.randomUUID();
function reportFile(name: string, rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '日报');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    originalname: name,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  };
}
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withDatabase('attribution_test')
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
  c = await mysql.createConnection({ ...target, multipleStatements: false });
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(1,'admin','unused','admin','管理员',NULL),(2,'leader','unused','leader','团长',NULL),(3,'creator','unused','creator','达人',2),(4,'direct','unused','creator','直属达人',NULL),(5,'outsider','unused','leader','其他团长',NULL)",
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5)');
  const [accounts] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
  scope.accountId = String(accounts[0].id);
  await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'ch1',1,'渠道甲')");
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task1','推广任务一',NOW())");
  resource = await import('../../src/modules/zhihu/attribution/resources');
  pool = (await import('../../src/db')).db;
  const cutover = await import('../../src/modules/zhihu/attribution/cutover');
  const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
  await cutover.configureRoute(admin, scope, {
    from: businessDay(),
    mode: 'trial',
    reason: '隔离数据库试算',
    sampleVerified: false,
  });
}, 90000);
afterAll(async () => {
  if (pool) await pool.end();
  if (c) await c.end();
  if (container) await container.stop({ remove: true, removeVolumes: true });
});
describe('独占资源数据库闭环', () => {
  it('创建账号范围渠道映射和词库，禁止同代理跨渠道重复', async () => {
    mappingId = (
      await resource.createMapping(admin, scope, key(), { channelId: '1', name: '渠道甲', from: '2020-01-01' })
    ).id;
    const input = {
      keyword: '独占词甲',
      taskId: '1',
      mappingId,
      landingUrl: 'https://www.zhihu.com/market/test',
      popularizeType: 1,
    };
    const receipt = key();
    const word = await resource.createKeyword(admin, scope, receipt, input);
    wordId = word.id;
    expect(await resource.createKeyword(admin, scope, receipt, input)).toEqual(word);
    await expect(resource.createKeyword(admin, scope, key(), input)).rejects.toThrow('已存在');
    await c.query("UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id='external1' WHERE id=?", [
      word.planId,
    ]);
  });
  it('50 个并发领取仅一次成功，同键重试返回同一绑定', async () => {
    await resource.synchronizeKeywords();
    const requests = Array.from({ length: 50 }, () => key());
    const results = await Promise.allSettled(requests.map((k) => resource.claim(leader, scope, wordId, k)));
    const index = results.findIndex((r) => r.status === 'fulfilled');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const result = results[index];
    if (result.status !== 'fulfilled') throw new Error('没有成功请求');
    bindingId = result.value.id;
    expect((await resource.claim(leader, scope, wordId, requests[index])).id).toBe(bindingId);
    await expect(
      resource.changeBinding(outsider, scope, bindingId, key(), { action: 'assign', executorId: '3' }),
    ).rejects.toThrow('无权');
  });
  it('团队成员可分配，先绑定后使用，使用后不能释放', async () => {
    await expect(
      resource.changeBinding(leader, scope, bindingId, key(), { action: 'assign', executorId: '4' }),
    ).rejects.toThrow('有效团队');
    await resource.changeBinding(leader, scope, bindingId, key(), { action: 'assign', executorId: '3' });
    await resource.changeBinding(creator, scope, bindingId, key(), { action: 'activate' });
    await expect(
      resource.changeBinding(leader, scope, bindingId, key(), { action: 'request-release', reason: '回收' }),
    ).rejects.toThrow('保留原归属');
    await expect(resource.listKeywords(creator, { ...scope, projectId: '999' }, 1, 25)).rejects.toThrow();
  });
  it('24 小时优先期及人工释放不重置开放时间', async () => {
    const word = await resource.createKeyword(admin, scope, key(), {
      keyword: '直属词乙',
      taskId: '1',
      mappingId,
      landingUrl: 'https://www.zhihu.com/test',
      popularizeType: 1,
    });
    await c.query("UPDATE plans SET sync_status='synced',status='active' WHERE id=?", [word.planId]);
    await resource.synchronizeKeywords();
    await expect(resource.claim(direct, scope, word.id, key())).rejects.toThrow('优先期');
    await c.query('UPDATE zh_keywords SET priority_until=NOW(3) WHERE id=?', [word.id]);
    const binding = await resource.claim(direct, scope, word.id, key());
    await resource.changeBinding(direct, scope, binding.id, key(), { action: 'request-release', reason: '尚未发布' });
    await expect(
      resource.changeBinding(leader, scope, binding.id, key(), { action: 'release', reason: '审核' }),
    ).rejects.toThrow();
    await resource.changeBinding(admin, scope, binding.id, key(), { action: 'release', reason: '已核实无外部作品' });
    expect((await resource.claim(direct, scope, word.id, key())).id).not.toBe(binding.id);
  });
});
describe('任务报价与金额', () => {
  it('失败的上游创建通过明确账号与项目范围重试，不重复创建词或计划', async () => {
    const word = await resource.createKeyword(admin, scope, key(), {
      keyword: '失败重试词',
      taskId: '1',
      mappingId,
      landingUrl: 'https://example.com/retry',
      popularizeType: 1,
    });
    await c.query("UPDATE plans SET sync_status='failed',sync_error='临时服务错误' WHERE id=?", [word.planId]);
    const receipt = key();
    expect((await resource.retryKeyword(admin, scope, word.id, receipt)).planId).toBe(word.planId);
    expect((await resource.retryKeyword(admin, scope, word.id, receipt)).planId).toBe(word.planId);
    const [stored] = await c.query<mysql.RowDataPacket[]>('SELECT sync_status FROM plans WHERE id=?', [word.planId]);
    expect(stored[0].sync_status).toBe('local');
    await expect(resource.retryKeyword(leader, scope, word.id, key())).rejects.toThrow('仅管理员');
  });
  it('20/15/13 样例按订单数量计算，达人只能查看自己的报价', async () => {
    const pricing = await import('../../src/modules/zhihu/attribution/pricing');
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    const { withTransaction } = await import('../../src/db');
    const up = await pricing.draftPrice(admin, scope, key(), {
      taskId: '1',
      payeeId: '2',
      unitPrice: '15',
      from: businessDay(),
      reason: '代理报价',
    });
    await pricing.publishPrice(admin, scope, up.id, key());
    const low = await pricing.draftPrice(leader, scope, key(), {
      taskId: '1',
      payeeId: '3',
      unitPrice: '13',
      from: businessDay(),
      reason: '团长报价',
    });
    await pricing.publishPrice(leader, scope, low.id, key());
    const amounts = await withTransaction((connection) =>
      pricing.quote(
        connection,
        scope,
        '1',
        { path_type: 'team_creator', leader_id: '2', executor_id: '3' } as mysql.RowDataPacket,
        businessDay(),
        '100',
      ),
    );
    expect(amounts.map((x) => x.amount)).toEqual(['1500.0000', '1300.0000']);
    const visible = await pricing.listPrices(creator, scope, 1, 25);
    expect(visible.list).toHaveLength(1);
    expect(visible.list[0].price).toBe('13.0000');
    await expect(
      pricing.draftPrice(leader, scope, key(), {
        taskId: '1',
        payeeId: '4',
        unitPrice: '13',
        from: businessDay(),
        reason: '越权',
      }),
    ).rejects.toThrow('不允许');
  });
  it('拒绝报价倒挂和重叠，未来调价不覆盖历史', async () => {
    const pricing = await import('../../src/modules/zhihu/attribution/pricing');
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    const tomorrow = businessDay(new Date(Date.now() + 86400000));
    const inverted = await pricing.draftPrice(admin, scope, key(), {
      taskId: '1',
      payeeId: '2',
      unitPrice: '12',
      from: tomorrow,
      reason: '倒挂检查',
    });
    await expect(pricing.publishPrice(admin, scope, inverted.id, key())).rejects.toThrow('高于进价');
    const future = await pricing.draftPrice(leader, scope, key(), {
      taskId: '1',
      payeeId: '3',
      unitPrice: '12',
      from: tomorrow,
      reason: '次日调价',
    });
    await pricing.publishPrice(leader, scope, future.id, key());
    const { withTransaction } = await import('../../src/db');
    const binding = { path_type: 'team_creator', leader_id: '2', executor_id: '3' } as mysql.RowDataPacket;
    const today = await withTransaction((connection) =>
      pricing.quote(connection, scope, '1', binding, businessDay(), '100'),
    );
    const next = await withTransaction((connection) => pricing.quote(connection, scope, '1', binding, tomorrow, '100'));
    expect(today[1].amount).toBe('1300.0000');
    expect(next[1].amount).toBe('1200.0000');
  });
  it('同任务直属达人与团长本人各只有一层应付，收款人价格相互独立', async () => {
    const pricing = await import('../../src/modules/zhihu/attribution/pricing'),
      { businessDay } = await import('../../src/modules/zhihu/attribution/domain'),
      { withTransaction } = await import('../../src/db');
    const price = await pricing.draftPrice(admin, scope, key(), {
      taskId: '1',
      payeeId: '4',
      unitPrice: '13',
      from: businessDay(),
      reason: '直属达人报价',
    });
    await pricing.publishPrice(admin, scope, price.id, key());
    const direct = await withTransaction((conn) =>
      pricing.quote(
        conn,
        scope,
        '1',
        { path_type: 'direct_creator', leader_id: null, executor_id: '4' } as mysql.RowDataPacket,
        businessDay(),
        '100',
      ),
    );
    const self = await withTransaction((conn) =>
      pricing.quote(
        conn,
        scope,
        '1',
        { path_type: 'leader_self', leader_id: '2', executor_id: '2' } as mysql.RowDataPacket,
        businessDay(),
        '100',
      ),
    );
    expect(direct.map((o) => o.amount)).toEqual(['1300.0000']);
    expect(self.map((o) => o.amount)).toEqual(['1500.0000']);
    await expect(
      withTransaction((conn) =>
        pricing.quote(
          conn,
          scope,
          '999',
          { path_type: 'direct_creator', leader_id: null, executor_id: '4' } as mysql.RowDataPacket,
          businessDay(),
          '100',
        ),
      ),
    ).rejects.toThrow('PRICE_MISSING');
  });
});
describe('报告事实与独占归因', () => {
  it('搜索订单分报合并、文件及行去重、保留全部原始值', async () => {
    const facts = await import('../../src/modules/zhihu/attribution/facts');
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    const search = reportFile('搜索.xlsx', [
      ['日期', '渠道名称', '关键词', '搜索量'],
      [businessDay(), '渠道甲', '独占词甲', '1000'],
    ]);
    const batch = await facts.previewImport(admin, scope, search, 'search');
    const detail = await facts.importDetail(admin, scope, batch.id, 1, 100);
    await facts.commitImport(admin, scope, batch.id, key(), String(detail.preview_hash));
    await facts.processBatch(admin, scope, batch.id);
    const order = reportFile('订单.xlsx', [
      ['日期', '渠道名称', '关键词', '搜索量', '订单', '收益'],
      [businessDay(), '渠道甲', '独占词甲', '1000', '100', '2000'],
      [businessDay(), '渠道甲', '独占词甲', '1000', '100', '2000'],
    ]);
    const other = await facts.previewImport(admin, scope, order, 'order');
    const d = await facts.importDetail(admin, scope, other.id, 1, 100);
    await facts.commitImport(admin, scope, other.id, key(), String(d.preview_hash));
    await facts.processBatch(admin, scope, other.id);
    expect((await facts.previewImport(admin, scope, { ...order, originalname: '重发.xlsx' }, 'order')).id).toBe(
      other.id,
    );
    const result = await facts.listAttributions(admin, scope, 1, 25);
    expect(result.list).toHaveLength(1);
    const item = result.list[0] as Record<string, unknown>;
    factId = String(item.id);
    originalRevision = String(item.revision_id);
    expect(item.search).toBe('1000');
    expect(item.orders).toBe('100');
    expect(item.agencyMargin).toBe('500.0000');
    const own = await facts.listAttributions(creator, scope, 1, 25);
    expect(own.list[0]).not.toHaveProperty('revenue');
    expect(own.list[0]).not.toHaveProperty('agencyMargin');
    const trace = await facts.trace(admin, scope, factId);
    expect(trace.revisions).toHaveLength(2);
    await expect(facts.importDetail(creator, scope, other.id, 1, 25)).rejects.toThrow('仅管理员');
  });
  it('渠道更名不重复事实；不同值进入修订，原结果保持不变', async () => {
    const facts = await import('../../src/modules/zhihu/attribution/facts');
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    await resource.createMapping(admin, scope, key(), {
      channelId: '1',
      name: '渠道甲新名',
      from: businessDay(),
      canonicalId: mappingId,
    });
    const file = reportFile('修订.xlsx', [
      ['日期', '渠道名称', '关键词', '订单', '收益'],
      [businessDay(), '渠道甲新名', '独占词甲', '90', '1800'],
    ]);
    const batch = await facts.previewImport(admin, scope, file, 'order'),
      detail = await facts.importDetail(admin, scope, batch.id, 1, 100);
    await facts.commitImport(admin, scope, batch.id, key(), String(detail.preview_hash));
    await facts.processBatch(admin, scope, batch.id);
    const exceptions = await facts.listExceptions(admin, scope, 1, 25);
    expect(exceptions.list[0].reason_code).toBe('SOURCE_REVISION_PENDING');
    pendingRevision = String(exceptions.list[0].revision_id);
    expect(((await facts.listAttributions(admin, scope, 1, 25)).list[0] as Record<string, unknown>).orders).toBe('100');
  });
});
describe('首次核验、对账及不可变差额', () => {
  it('核验、待定修订与付款顺序均阻止提前确认', async () => {
    const s = await import('../../src/modules/zhihu/attribution/statements');
    const facts = await import('../../src/modules/zhihu/attribution/facts');
    const up = (await s.previewStatement(admin, scope, key(), factId)).entries[0];
    const low = (await s.previewStatement(leader, scope, key(), factId)).entries[0];
    const hash = async (id: string) => {
      const [r] = await c.query<mysql.RowDataPacket[]>('SELECT input_hash FROM zh_statement_entries WHERE id=?', [id]);
      return String(r[0].input_hash);
    };
    await expect(s.confirmStatement(leader, scope, low.id, key(), await hash(low.id))).rejects.toThrow('试算模式');
    const cutover = await import('../../src/modules/zhihu/attribution/cutover');
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    await cutover.configureRoute(admin, scope, {
      from: businessDay(),
      mode: 'enabled',
      reason: '仅隔离库金额样例验证',
      sampleVerified: true,
    });
    await expect(s.confirmStatement(leader, scope, low.id, key(), await hash(low.id))).rejects.toThrow('首次作品');
    const evidence = await s.submitEvidence(creator, scope, key(), {
      bindingId,
      url: 'https://example.com/work/1',
      description: '首次作品含独占词',
    });
    await expect(s.reviewEvidence(creator, scope, evidence.id, key(), true, '本人核验')).rejects.toThrow('仅管理员');
    await s.reviewEvidence(leader, scope, evidence.id, key(), true, '已核对关键词和作者');
    await expect(s.confirmStatement(leader, scope, low.id, key(), await hash(low.id))).rejects.toThrow('来源修订');
    await facts.acceptRevision(admin, scope, pendingRevision, key(), originalRevision, '暂不采纳待核实版本', false);
    const { businessDay: statementDay } = await import('../../src/modules/zhihu/attribution/domain');
    expect(
      (await s.previewPeriod(leader, scope, key(), { from: statementDay(), to: statementDay() })).entries[0].id,
    ).toBe(low.id);
    await expect(
      s.confirmBatch(leader, scope, key(), [
        { id: low.id, expectedHash: await hash(low.id) },
        { id: up.id, expectedHash: await hash(up.id) },
      ]),
    ).rejects.toThrow('付款主体');
    const [unconfirmed] = await c.query<mysql.RowDataPacket[]>('SELECT status FROM zh_statement_entries WHERE id=?', [
      low.id,
    ]);
    expect(unconfirmed[0].status).toBe('draft');
    await expect(s.confirmStatement(admin, scope, up.id, key(), await hash(up.id))).rejects.toThrow('先由团长');
    await s.confirmBatch(leader, scope, key(), [{ id: low.id, expectedHash: await hash(low.id) }]);
    const upperHash = await hash(up.id);
    await Promise.all(Array.from({ length: 10 }, () => s.confirmStatement(admin, scope, up.id, key(), upperHash)));
    const own = await s.listStatements(creator, scope, 1, 25);
    expect(own.list).toHaveLength(1);
    expect(own.list[0].target_amount).toBe('1300.0000');
    const [count] = await c.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM zh_statement_entries WHERE status='confirmed'",
    );
    expect(Number(count[0].n)).toBe(2);
  });
  it('修订生成 -150 / -130 调整，争议暂停确认，历史确认不变', async () => {
    const s = await import('../../src/modules/zhihu/attribution/statements');
    const facts = await import('../../src/modules/zhihu/attribution/facts');
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    const file = reportFile('核实后的修订.xlsx', [
      ['日期', '渠道名称', '关键词', '订单', '收益', '备注'],
      [businessDay(), '渠道甲新名', '独占词甲', '90', '1800', '已核实'],
    ]);
    const b = await facts.previewImport(admin, scope, file, 'order'),
      d = await facts.importDetail(admin, scope, b.id, 1, 100);
    await facts.commitImport(admin, scope, b.id, key(), d.preview_hash);
    await facts.processBatch(admin, scope, b.id);
    const e = (await facts.listExceptions(admin, scope, 1, 25)).list.find((x) => x.status === 'open');
    expect(e).toBeDefined();
    await facts.acceptRevision(admin, scope, String(e!.revision_id), key(), originalRevision, '知乎确认 90 笔');
    const list = (await s.listStatements(admin, scope, 1, 25)).list;
    const adjustments = list.filter((x) => x.entry_kind === 'adjustment');
    expect(adjustments.map((x) => x.amount).sort()).toEqual(['-130.0000', '-150.0000']);
    const low = adjustments.find((x) => x.relation_type === 'leader_creator')!,
      up = adjustments.find((x) => x.relation_type === 'agency_leader')!;
    await expect(s.confirmStatement(admin, scope, String(up.id), key(), String(up.input_hash))).rejects.toThrow(
      '先由团长',
    );
    await s.disputeBinding(creator, scope, bindingId, key(), false, '来源争议');
    await expect(s.confirmStatement(leader, scope, String(low.id), key(), String(low.input_hash))).rejects.toThrow(
      '争议',
    );
    await s.disputeBinding(admin, scope, bindingId, key(), true, '已复核');
    await s.confirmStatement(leader, scope, String(low.id), key(), String(low.input_hash));
    await s.confirmStatement(admin, scope, String(up.id), key(), String(up.input_hash));
    expect(
      list
        .filter((x) => x.entry_kind === 'initial')
        .map((x) => x.amount)
        .sort(),
    ).toEqual(['1300.0000', '1500.0000']);
    const [legacy] = await c.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM earnings');
    expect(Number(legacy[0].n)).toBe(0);
  });
});
describe('队列恢复、公共摘要和切换保护', () => {
  it('不同账号与项目的同名渠道不会引用另一范围的关键词、报价或事实', async () => {
    const facts = await import('../../src/modules/zhihu/attribution/facts'),
      cutover = await import('../../src/modules/zhihu/attribution/cutover'),
      { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    await c.query("INSERT INTO projects(id,name,slug) VALUES(2,'隔离项目','isolated-two')");
    await c.query(
      "INSERT INTO integration_accounts(id,module_id,account_key,name) VALUES(2,'zhihu','isolated-test','隔离测试账号')",
    );
    await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(2,2)');
    await c.query('INSERT INTO project_members(project_id,user_id) VALUES(2,3)');
    await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(2,2,'ch1',1,'渠道甲')");
    await c.query(
      "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(2,2,'task1','推广任务一',NOW())",
    );
    const second = { accountId: '2', projectId: '2' };
    await cutover.configureRoute(admin, second, {
      from: businessDay(),
      mode: 'trial',
      reason: '仅隔离账号测试',
      sampleVerified: false,
    });
    const mapping = await resource.createMapping(admin, second, key(), {
      channelId: '2',
      name: '渠道甲',
      from: businessDay(),
    });
    await expect(
      resource.createKeyword(admin, second, key(), {
        keyword: '独占词甲',
        taskId: '2',
        mappingId: mapping.id,
        landingUrl: 'https://example.com/work',
        popularizeType: 1,
      }),
    ).rejects.toThrow('已存在');
    const batch = await facts.previewImport(
        admin,
        second,
        reportFile('跨范围.xlsx', [
          ['日期', '渠道名称', '关键词', '订单', '收益'],
          [businessDay(), '渠道甲', '独占词甲', 90, 1800],
        ]),
        'order',
      ),
      detail = await facts.importDetail(admin, second, batch.id, 1, 25);
    await facts.commitImport(admin, second, batch.id, key(), detail.preview_hash);
    await facts.processBatch(admin, second, batch.id);
    expect((await facts.listExceptions(admin, second, 1, 25)).list[0].reason_code).toBe('KEYWORD_UNKNOWN');
    expect((await facts.listAttributions(creator, second, 1, 25)).total).toBe(0);
    await expect(facts.trace(creator, second, factId)).rejects.toThrow('无权');
  });
  it('HTTP 契约使用 camelCase，达人读接口不包含上游金额或其他范围', async () => {
    const express = (await import('express')).default,
      request = (await import('supertest')).default;
    const { attributionRouter } = await import('../../src/modules/zhihu/routes/attribution'),
      { errorHandler } = await import('../../src/middleware/errors'),
      { signToken } = await import('../../src/auth/jwt');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/modules/zhihu', attributionRouter);
    app.use(errorHandler);
    app.post('/api/v1/modules/zhihu/existing-signed-callback', (_req, res) => res.sendStatus(204));
    expect((await request(app).post('/api/v1/modules/zhihu/existing-signed-callback')).status).toBe(204);
    const token = await signToken({
        id: '3',
        role: 'creator',
        username: 'creator',
        displayName: '达人',
        parentId: '2',
      }),
      adminToken = await signToken({
        id: '1',
        role: 'admin',
        username: 'admin',
        displayName: '管理员',
        parentId: null,
      });
    const options = await request(app)
      .get('/api/v1/modules/zhihu/attribution-options')
      .query(scope)
      .set('Authorization', 'Bearer ' + adminToken);
    expect(options.status).toBe(200);
    expect(options.body.data.mappings[0]).toHaveProperty('channelName');
    expect(options.body.data.users[0]).toHaveProperty('displayName');
    const result = await request(app)
      .get('/api/v1/modules/zhihu/attributions')
      .query(scope)
      .set('Authorization', 'Bearer ' + token);
    expect(result.status).toBe(200);
    expect(result.body.data.list[0]).toHaveProperty('verificationStatus');
    expect(result.body.data.list[0]).not.toHaveProperty('revenue');
    expect(result.body.data.list[0].obligations).toHaveLength(1);
    const denied = await request(app)
      .get('/api/v1/modules/zhihu/attributions')
      .query({ ...scope, projectId: '999' })
      .set('Authorization', 'Bearer ' + token);
    expect(denied.status).toBe(403);
  });
  it('投递失败保留待办，租约过期恢复未处理行，重复 Worker 不重复计量', async () => {
    const facts = await import('../../src/modules/zhihu/attribution/facts'),
      worker = await import('../../src/modules/zhihu/attribution/worker'),
      queue = await import('../../src/queue');
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    const rows = Array.from({ length: 205 }, () => [businessDay(), '渠道甲', '独占词甲', '1000']);
    const batch = await facts.previewImport(
      admin,
      scope,
      reportFile('恢复测试.xlsx', [['日期', '渠道名称', '关键词', '搜索量'], ...rows]),
      'search',
    );
    const d = await facts.importDetail(admin, scope, batch.id, 1, 100);
    await facts.commitImport(admin, scope, batch.id, key(), d.preview_hash);
    const [jobs] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM zh_processing_jobs WHERE batch_id=?', [
      batch.id,
    ]);
    const jobId = String(jobs[0].id),
      payload = { ...scope, moduleId: 'zhihu', jobId };
    const delivery = vi.spyOn(queue, 'enqueue').mockRejectedValue(new Error('测试投递断开'));
    await worker.recoverImports();
    delivery.mockRestore();
    const partial = await facts.processBatch(admin, scope, batch.id);
    expect(partial.remaining).toBe(5);
    await c.query(
      "UPDATE zh_processing_jobs SET status='running',lease_token='interrupted',lease_until=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
      [jobId],
    );
    await Promise.all([worker.processImportJob(payload), worker.processImportJob(payload)]);
    const [job] = await c.query<mysql.RowDataPacket[]>('SELECT status FROM zh_processing_jobs WHERE id=?', [jobId]);
    expect(job[0].status).toBe('done');
    const final = await facts.importDetail(admin, scope, batch.id, 1, 100);
    expect(final.counts.find((x) => x.processing_status === 'duplicate')?.total).toBe(205);
    const [statements] = await c.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM zh_statement_entries WHERE status='confirmed'",
    );
    expect(Number(statements[0].n)).toBe(4);
    await c.query("UPDATE integration_accounts SET status='disabled' WHERE id=?", [scope.accountId]);
    try {
      await expect(worker.processImportJob(payload)).rejects.toThrow('账号或项目');
    } finally {
      await c.query("UPDATE integration_accounts SET status='active' WHERE id=?", [scope.accountId]);
    }
    await expect(worker.processImportJob({ ...payload, accountId: 'legacy' })).rejects.toThrow('明确范围');
    worker.registerAttributionJobs();
    await worker.recoverImports();
    await vi.waitFor(
      async () => {
        const [remaining] = await c.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) n FROM zh_processing_jobs WHERE status<>'done'",
        );
        expect(Number(remaining[0].n)).toBe(0);
      },
      { timeout: 5000, interval: 50 },
    );
  });
  it('并行修订基于过期父版本时拒绝接受，重建候选保留其他来源的新指标', async () => {
    const facts = await import('../../src/modules/zhihu/attribution/facts'),
      { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    const add = async (kind: 'order' | 'search', rows: unknown[][]) => {
      const b = await facts.previewImport(admin, scope, reportFile(kind + '-并行.xlsx', rows), kind),
        d = await facts.importDetail(admin, scope, b.id, 1, 25);
      await facts.commitImport(admin, scope, b.id, key(), d.preview_hash);
      await facts.processBatch(admin, scope, b.id);
    };
    await add('search', [
      ['日期', '渠道名称', '关键词', '搜索量'],
      [businessDay(), '渠道甲', '独占词甲', 1001],
    ]);
    await add('order', [
      ['日期', '渠道名称', '关键词', '订单', '收益'],
      [businessDay(), '渠道甲', '独占词甲', 91, 1820],
    ]);
    const pending = (await facts.listExceptions(admin, scope, 1, 25)).list.filter((e) => e.status === 'open');
    expect(pending).toHaveLength(2);
    const older = pending[1],
      newer = pending[0];
    await facts.acceptRevision(
      admin,
      scope,
      String(older.revision_id),
      key(),
      String(older.expected_revision_id),
      '先核实搜索修订',
    );
    await expect(
      facts.acceptRevision(admin, scope, String(newer.revision_id), key(), String(older.revision_id), '过期候选'),
    ).rejects.toThrow('当前事实已变化');
    const rebased = await facts.rebaseRevision(
      admin,
      scope,
      String(newer.revision_id),
      key(),
      String(older.revision_id),
      '合并最新搜索口径后重新核对',
    );
    const [r] = await c.query<mysql.RowDataPacket[]>('SELECT snapshot_json FROM zh_metric_revisions WHERE id=?', [
      rebased.id,
    ]);
    const snapshot = typeof r[0].snapshot_json === 'string' ? JSON.parse(r[0].snapshot_json) : r[0].snapshot_json;
    expect(snapshot.search).toBe('1001');
    expect(snapshot.orders).toBe('91');
    await facts.acceptRevision(
      admin,
      scope,
      rebased.id,
      key(),
      String(older.revision_id),
      '订单修订缺少证据，驳回',
      false,
    );
  });
  it('只读摘要金额隔离，停止后不能确认新来源，也不能退回旧入账', async () => {
    const { attributionDataProvider } = await import('../../src/modules/zhihu/attribution/provider');
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain');
    const { withTransaction } = await import('../../src/db');
    const summary = await attributionDataProvider.summary(
      { ...scope, from: businessDay(), to: businessDay() },
      creator,
    );
    expect(summary.status).toBe('ready');
    expect(summary.metrics.map((x) => x.value)).toEqual(['90', '1001']);
    expect(summary.metrics.every((x) => x.unit !== 'CNY')).toBe(true);
    const route = await import('../../src/modules/zhihu/attribution/routing'),
      cutover = await import('../../src/modules/zhihu/attribution/cutover');
    await expect(
      withTransaction((conn) => route.assertLegacyRoute(conn, scope.projectId, businessDay())),
    ).rejects.toThrow('禁止旧流程');
    await expect(withTransaction((conn) => route.assertLegacyRoute(conn, null, null))).rejects.toThrow('无法证明');
    await withTransaction((conn) => route.assertLegacyRoute(conn, scope.projectId, '2020-01-01'));
    await cutover.configureRoute(admin, scope, {
      from: businessDay(),
      mode: 'stopped',
      reason: '隔离库回退演练',
      sampleVerified: false,
    });
    await expect(withTransaction((conn) => route.assertNewRoute(conn, scope, businessDay()))).rejects.toThrow(
      '停止写入',
    );
    await expect(
      withTransaction((conn) => route.assertLegacyRoute(conn, scope.projectId, businessDay())),
    ).rejects.toThrow('禁止旧流程');
    await expect(
      cutover.configureRoute(admin, scope, {
        from: '2020-01-01',
        mode: 'trial',
        reason: '移动边界',
        sampleVerified: false,
      }),
    ).rejects.toThrow('不可移动');
    const [legacy] = await c.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM earnings');
    expect(Number(legacy[0].n)).toBe(0);
  });
  it('旧报表在 MySQL 8 可重复预览、按原始行分页并确认历史日期', async () => {
    const legacyImport = await import('../../src/modules/zhihu/services/data-import.service');
    const file = reportFile('历史分页回归.xlsx', [
      ['日期', '渠道名称', '关键词', '搜索量', '订单', '收益'],
      ['2020-01-02', '渠道甲', '历史分页甲', 200, 20, 400],
      ['2020-01-02', '渠道甲', '历史分页乙', 300, 30, 600],
    ]);
    const batch = await legacyImport.parseDataImport(admin, file, 'manual_excel');
    const duplicate = await legacyImport.parseDataImport(admin, file, 'manual_excel');
    expect(duplicate.id).toBe(batch.id);
    expect(duplicate.isDuplicate).toBe(true);
    expect(duplicate.previewRows.map((row) => row.rowNumber)).toEqual([2, 3]);
    for (const page of [1, 2]) {
      const detail = await legacyImport.getDataImportBatch(admin, batch.id, page, 1);
      expect(detail.total).toBe(2);
      expect(detail.rows.map((row) => row.rowNumber)).toEqual([page + 1]);
    }
    const confirmed = await legacyImport.confirmDataImport(admin, batch.id);
    expect(confirmed.imported).toBe(2);
    expect(confirmed.taskIds).toHaveLength(2);
    const repeated = await legacyImport.confirmDataImport(admin, batch.id);
    expect(repeated.taskIds).toEqual(confirmed.taskIds);
    const [historicalMoney] = await c.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM earnings');
    expect(Number(historicalMoney[0].n)).toBe(0);
  });
  it('旧导入确认、手动审批、自动结算和旧计划修改不能绕过边界', async () => {
    const { businessDay } = await import('../../src/modules/zhihu/attribution/domain'),
      legacyImport = await import('../../src/modules/zhihu/services/data-import.service'),
      relay = await import('../../src/modules/zhihu/services/relay.service'),
      plans = await import('../../src/modules/zhihu/services/plans.service'),
      { settleEarnings } = await import('../../src/modules/zhihu/jobs/settleEarnings');
    const batch = await legacyImport.parseDataImport(
      admin,
      reportFile('旧入口报告.xlsx', [
        ['日期', '渠道名称', '关键词', '搜索量', '订单', '收益'],
        [businessDay(), '渠道甲', '独占词甲', 1000, 90, 1800],
      ]),
      'manual_excel',
    );
    await expect(legacyImport.confirmDataImport(admin, String(batch.id))).rejects.toThrow('新引擎已停止写入');
    const [created] = await c.query<mysql.ResultSetHeader>(
      "INSERT INTO settlement_batches(title,period_start,period_end,created_by) VALUES('旧手动批次',?,?,1)",
      [businessDay(), businessDay()],
    );
    await expect(relay.approveBatch(admin, String(created.insertId))).rejects.toThrow('禁止旧流程');
    const [word] = await c.query<mysql.RowDataPacket[]>('SELECT plan_id FROM zh_keywords WHERE id=?', [wordId]);
    await expect(
      plans.updatePlan(admin, String(word[0].plan_id), { landingUrl: 'https://example.com/change' }),
    ).rejects.toThrow('独占词库');
    await expect(plans.deletePlan(admin, String(word[0].plan_id))).rejects.toThrow('独占词库');
    await c.query(
      "INSERT INTO daily_metrics(project_id,channel_id,plan_id,owner_id,stat_date,keyword,earning,fetched_at) VALUES(1,'ch1',?,3,?,?,1800,NOW())",
      [word[0].plan_id, businessDay(), '独占词甲'],
    );
    await settleEarnings({ from: businessDay(), to: businessDay() });
    const [money] = await c.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM earnings');
    expect(Number(money[0].n)).toBe(0);
  });
});
