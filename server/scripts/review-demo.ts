// Local review environment: starts the full app with a mocked Zhihu upstream and,
// on a freshly bootstrapped database, writes a small team/keyword/report dataset.
import 'dotenv/config';
import { riskReviewHandlers } from '../tests/attribution-ui/risk-upstream';
import { saltReviewHandlers } from '../tests/attribution-ui/salt-upstream';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import express from 'express';

if (process.env.NODE_ENV === 'production') throw new Error('演示数据禁止写入生产环境');
process.env.OPC_MODULES = 'zhihu';
process.env.QUEUE_DRIVER ??= 'memory';
// Keep the real authentication/session path even during synthetic card exploration.
process.env.DEV_DEMO_AUTH = '0';
process.env.ZHIHU_API_BASE = 'https://open.zhihu.com';
const DEMO_USERS = ['leader_wang', 'creator_li', 'creator_zhang', 'creator_chen', 'operator_chen', 'finance_wang', 'developer_sun'];

let planSeq = 2071265453767400;
let compositionSeq = 2071265453767500;
async function main() {
  const network = setupServer(
    http.post('*/alliance/api/popularize_plan', () => HttpResponse.json({ data: { plan_id: String(++planSeq) } })),
    http.post('*/alliance/api/popularize_composition/v2', () => HttpResponse.json({ data: { composition_id: String(++compositionSeq) } })),
    ...riskReviewHandlers(),
    ...saltReviewHandlers(),
    http.all('https://open.zhihu.com/*', () => HttpResponse.json({ error: { message: 'mock upstream' } }, { status: 503 })),
  );
  network.listen({ onUnhandledRequest: 'bypass' });
  const c = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    timezone: '+08:00',
  });
  await c.query("SET SESSION time_zone='+08:00'");
  // The review database may share a UTC MySQL instance. Configure only this
  // process's sessions, before queries are queued, to match the normal driver.
  const { db } = await import('../src/db');
  db.pool.on('connection', (connection: import('mysql2').PoolConnection) => {
    connection.query("SET SESSION time_zone='+08:00'");
  });
  const [[{ total }]] = await c.query<mysql.RowDataPacket[]>('SELECT COUNT(*) total FROM users');
  const [seeded] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM users WHERE username IN (?)', [DEMO_USERS]);
  const fresh = Number(total) === 1 && !seeded.length;
  if (!fresh && !seeded.length) console.warn('数据库不是刚初始化的空库，跳过写入演示数据，只启动服务');
  if (fresh) {
    const hash = await bcrypt.hash('Review123456', 4);
    await c.query(
      `INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES
      (2,'leader_wang',?,'leader','王团长',NULL),(3,'creator_li',?,'creator','小李',2),
      (4,'creator_zhang',?,'creator','小张',2),(5,'creator_chen',?,'creator','小陈',NULL)`,
      [hash, hash, hash, hash],
    );
    await c.query(
      `INSERT INTO users(id,username,password_hash,role,display_name,parent_id,admin_duty) VALUES
      (6,'operator_chen',?,'operator','陈运营',NULL,'all'),(7,'finance_wang',?,'admin','王财务',NULL,'finance'),
      (8,'developer_sun',?,'developer','孙开发',NULL,'all')`,
      [hash, hash, hash],
    );
    await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,4),(1,5)');
    await c.query("INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'ch-1',1,'知乎故事一代渠道')");
    await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'task-1','知乎故事推广任务',NOW())");
  }
  if (fresh || seeded.length) await c.query('UPDATE users SET must_change_pwd=0 WHERE username IN (?)', [[...DEMO_USERS, 'admin']]);
  const { createCoreApp } = await import('../src/core/app');
  const { loadModules } = await import('../src/composition/modules');
  const { mountStatic } = await import('../src/composition/static');
  const runtime = loadModules();
  const realApp = createCoreApp(runtime, mountStatic);
  const app = express();
  if (process.env.DEMO_INSIGHTS_MOCK === '1') {
    const { mountDemoInsights } = await import('./demo-insights-mock');
    app.use(express.json({ limit: '1mb' }));
    mountDemoInsights(app);
    console.warn('已明确启用合成统计演示；这些卡片不用于真实接口验收');
  }
  app.use(realApp);
  const { errorHandler } = await import('../src/middleware/errors');
  app.use(errorHandler);
  app.locals.moduleRuntime = runtime;
  if (fresh) {
    await seed(c);
  }
  await c.end();
  // Match the real server lifecycle so committed previews and confirmation jobs
  // are consumed during browser review as well.
  if (process.env.RUN_BACKGROUND_JOBS === 'true') app.locals.moduleRuntime.start();
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, '127.0.0.1', () => console.log(`演示服务已就绪：http://127.0.0.1:${port}/app/`));
}

async function seed(c: mysql.Connection) {
  const resources = await import('../src/modules/zhihu/attribution/resources');
  const prices = await import('../src/modules/zhihu/attribution/pricing');
  const statements = await import('../src/modules/zhihu/attribution/statements');
  const workbench = await import('../src/modules/zhihu/attribution/workbench');
  const { insertComposition } = await import('../src/modules/zhihu/services/compositions.service');
  const { businessDay } = await import('../src/modules/zhihu/attribution/domain');
  const { withTransaction } = await import('../src/db');
  const user = (sub: string, role: 'admin' | 'leader' | 'creator', parentId: string | null = null) =>
    ({ sub, role, parentId, username: role, displayName: role, jti: randomUUID(), permissions: [] }) as any;
  const admin = user('1', 'admin'), leader = user('2', 'leader'), li = user('3', 'creator', '2'),
    zhang = user('4', 'creator', '2'), chen = user('5', 'creator');
  const scope = { projectId: '1', accountId: '1' };
  const today = businessDay();
  const from = new Date(Date.parse(today) - 7 * 86400000).toISOString().slice(0, 10);
  const mapping = await resources.createMapping(admin, scope, randomUUID(), { channelId: '1', name: '知乎故事一代渠道', from });
  const words: Record<string, { id: string; planId: string }> = {};
  for (const keyword of ['都市逆袭小说', '重生千金', '甜宠文推荐', '古言虐恋', '悬疑短篇', '修仙爽文']) {
    const w = await resources.createKeyword(admin, scope, randomUUID(), {
      keyword, taskId: '1', mappingId: mapping.id, landingUrl: 'https://www.zhihu.com/market/test', popularizeType: 0,
    } as any);
    const deadline = Date.now() + 15000;
    while (true) {
      const [plans] = await c.query<mysql.RowDataPacket[]>('SELECT sync_status FROM plans WHERE id=?', [w.planId]);
      if (plans[0]?.sync_status === 'synced') break;
      if (Date.now() > deadline) throw Error('plan sync timeout ' + keyword);
      await new Promise((r) => setTimeout(r, 200));
    }
    words[keyword] = w;
  }
  const claimAssign = async (keyword: string, executor: any, claimer = leader) => {
    const b = claimer === admin ? { id: (await resources.distribute(admin, scope, words[keyword].id, randomUUID(), executor.sub)).id }
      : await resources.claim(claimer, scope, words[keyword].id, randomUUID());
    if (claimer === leader && executor) await resources.changeBinding(leader, scope, b.id, randomUUID(), { action: 'assign', executorId: executor.sub } as any);
    if (executor) await resources.changeBinding(executor, scope, b.id, randomUUID(), { action: 'activate' } as any);
    return b.id;
  };
  await claimAssign('都市逆袭小说', leader);
  const liBinding = await claimAssign('重生千金', li);
  await claimAssign('甜宠文推荐', zhang);
  await claimAssign('古言虐恋', chen, admin);
  await resources.claim(leader, scope, words['修仙爽文'].id, randomUUID());
  for (const [payer, payeeId, unitPrice] of [[admin, '2', '8.5'], [admin, '5', '8'], [leader, '3', '8'], [leader, '4', '8']] as const) {
    const d = await prices.draftPrice(payer, scope, randomUUID(), { taskId: '1', payeeId, unitPrice, from: today, reason: '本地体验报价' });
    await prices.publishPrice(payer, scope, d.id, randomUUID());
  }
  const compositionId = await withTransaction(async (conn) => {
    const id = await insertComposition(li, {
      planId: words['重生千金'].planId, mediaType: 'KOC抖音', mediaAccount: 'xiaoli_dy', compositionType: 1,
      compositionSubType: 1, title: '重生千金推文第一期', promoUrl: 'https://www.douyin.com/video/7300000000000000001',
      releaseTime: new Date().toISOString(),
    }, conn);
    await statements.insertEvidence(conn, li, scope, { bindingId: liBinding, url: 'https://www.douyin.com/video/7300000000000000001', description: '重生千金推文第一期' });
    return id;
  });
  const { pushComposition } = await import('../src/modules/zhihu/jobs/pushComposition');
  await pushComposition({ compositionId });
  const [ev] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM zh_evidence WHERE binding_id=?', [liBinding]);
  await statements.reviewEvidence(leader, scope, String(ev[0].id), randomUUID(), true, '已核对作品');
  const sheet = XLSX.utils.aoa_to_sheet([
    ['日期时间', '渠道名称', '关键词', '推广任务', '风险判定', '搜索量', '订单量'],
    [today, '知乎故事一代渠道', '都市逆袭小说', '知乎故事推广任务', null, 300, 10],
    [today, '知乎故事一代渠道', '重生千金', '知乎故事推广任务', null, 500, 20],
    [today, '知乎故事一代渠道', '甜宠文推荐', '知乎故事推广任务', null, 120, 4],
    [today, '知乎故事一代渠道', '古言虐恋', '知乎故事推广任务', null, 90, 3],
    [today, '知乎故事一代渠道', '悬疑短篇', '知乎故事推广任务', null, 150, 5],
    [today, '知乎故事一代渠道', '未登记的词', '知乎故事推广任务', null, 60, 2],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, '数据');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  await workbench.uploadReport(admin, scope, { originalname: '本地体验报表.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer, size: buffer.length } as any);
  console.log('演示数据已写入，报表日期', today);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
