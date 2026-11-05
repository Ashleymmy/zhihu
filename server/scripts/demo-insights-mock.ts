/**
 * Demo 环境的员工首页 mock 数据源。
 * 财务/管理员/运营的可视化卡（上游收入、支出、留存、排行、对账、打款）的真实账源接口
 * 由后端另行实现（BE-08/BE-02）；本模块按目标契约在 demo 服务上返回演示数据，
 * 正式接口上线后同路径替换，前端零改动。
 * 金额一律字符串；运营岗位（无金额权限）返回非金额字段。
 */
import type { Express, Request, RequestHandler } from 'express';
import type { AuthUser } from '../src/types';
import { AppError } from '../src/middleware/errors';
import { requireAuth } from '../src/auth/middleware';
import { isStaffRole } from '../src/auth/roles';

const noAmount = (user?: AuthUser) => !user || (user.role === 'operator') || (user.role === 'admin' && user.adminDuty === 'operations');
/** 平台总览只面向员工：成员读平台金额违反岗位边界 */
const staffOnly: RequestHandler = (req, _res, next) =>
  isStaffRole((req as Request & { user?: AuthUser }).user?.role ?? '') ? next() : next(new AppError(403, 40301, '无权执行此操作'));
const guard = [requireAuth, staffOnly];

/** 确定性日序列（同一基准每天生成的形状稳定，日期随波变动） */
function dailySeries(days: number, base: number, amp: number, seed = 0): { date: string; value: string }[] {
  const out: { date: string; value: string }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const k = days - 1 - i;
    const v = Math.max(0, Math.round(base + amp * Math.sin(k / 3.2 + seed) + amp * 0.45 * Math.sin(k / 2.3 + seed * 2)));
    out.push({ date: d.toISOString().slice(0, 10), value: String(v) });
  }
  return out;
}

export function mountDemoInsights(app: Express) {
  const authed = (req: Request): AuthUser | undefined => (req as Request & { user?: AuthUser }).user;

  /** 员工总览四数卡：上游收入、成员支出、平台留存、活跃成员 */
  app.get('/api/v1/core/insights/summary', ...guard, (req, res) => {
    if (noAmount(authed(req))) {
      return res.json({ code: 0, data: { activeMembers: 108, upstreamChange: '+32.9%', taskCount: 12406, activeTeams: 12, newMembers: 14 } });
    }
    res.json({
      code: 0,
      data: {
        upstream: '62480.00', memberPayout: '48360.00', retention: '14120.00', activeMembers: 108,
        upstreamChange: '+32.9%', payoutRatio: '77.4%', retentionRate: '22.6%',
      },
    });
  });

  /** 上游收入 vs 成员支出日序列（趋势图）；运营端返回业务量序列 */
  app.get('/api/v1/core/insights/daily', ...guard, (req, res) => {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    if (noAmount(authed(req))) {
      return res.json({
        code: 0,
        data: {
          labels: dailySeries(days, 0, 0).map(d => d.date),
          series: [
            { key: 'zhihu', label: '知乎', unit: '单', values: dailySeries(days, 400, 120, 0.4).map(d => d.value) },
            { key: 'hongguo', label: '红果', unit: '次', values: dailySeries(days, 300, 90, 1.1).map(d => d.value) },
            { key: 'wangpan', label: '网盘', unit: '个', values: dailySeries(days, 90, 30, 2.2).map(d => d.value) },
          ],
        },
      });
    }
    res.json({
      code: 0,
      data: {
        labels: dailySeries(days, 0, 0).map(d => d.date),
        series: [
          { key: 'upstream', label: '上游收入', unit: '元', values: dailySeries(days, 1800, 320, 0.2).map(d => d.value) },
          { key: 'payout', label: '成员支出', unit: '元', values: dailySeries(days, 1400, 260, 1.1).map(d => d.value) },
        ],
      },
    });
  });

  /** 团队排行（上游贡献）；运营端只给业绩量 */
  app.get('/api/v1/core/insights/team-top', ...guard, (req, res) => {
    const list = [
      { name: '温嘉树团队', quantity: 1310, amount: '13100.00' },
      { name: '苏禾团队', quantity: 1220, amount: '12200.00' },
      { name: '唐知远团队', quantity: 950, amount: '9500.00' },
      { name: '宋北辰团队', quantity: 900, amount: '9000.00' },
      { name: '何若溪团队', quantity: 890, amount: '8900.00' },
      { name: '江照野团队', quantity: 290, amount: '2900.00' },
    ];
    res.json({ code: 0, data: { list: noAmount(authed(req)) ? list.map(({ name, quantity }) => ({ name, quantity })) : list } });
  });

  /** 平台留存构成（财务/管理员） */
  app.get('/api/v1/core/insights/retention', ...guard, (req, res) => {
    if (noAmount(authed(req))) {
      return res.json({ code: 0, data: { teamCount: 12, newTeams: 2, soloCreators: 18 } });
    }
    res.json({
      code: 0,
      data: { rate: 0.226, parts: [{ label: '项目单价差', amount: '13000.00' }, { label: '无团长差价', amount: '601.00' }, { label: '邀请满 180 天', amount: '21.00' }] },
    });
  });

  /** 今日打款（财务/管理员） */
  app.get('/api/v1/core/finance/today-payouts', ...guard, (req, res) => {
    if (noAmount(authed(req))) return res.status(403).json({ code: 40300, message: '无权查看打款' });
    res.json({
      code: 0,
      data: {
        count: 3,
        list: [
          { name: '林小满', amount: '420.00', method: '微信零钱', status: '已登记发放' },
          { name: '顾知夏', amount: '1204.60', method: '银行卡 ··· 6218', status: '待发放' },
          { name: '唐南乔', amount: '86.00', method: '微信零钱', status: '已登记发放' },
        ],
      },
    });
  });

  /** 对账进度（财务/管理员） */
  app.get('/api/v1/core/finance/reconcile-progress', ...guard, (req, res) => {
    if (noAmount(authed(req))) return res.status(403).json({ code: 40300, message: '无权查看对账' });
    res.json({
      code: 0,
      data: {
        rate: 0.86, checkedDays: 48, totalDays: 56,
        byProject: [
          { name: '知乎推文', checked: 19, total: 20 },
          { name: '红果短剧', checked: 14, total: 20 },
          { name: '网盘拉新', checked: 20, total: 20 },
        ],
      },
    });
  });

  /** 待审批提现汇总（财务主卡） */
  app.get('/api/v1/core/finance/withdrawals/pending', ...guard, (req, res) => {
    if (noAmount(authed(req))) return res.status(403).json({ code: 40300, message: '无权查看提现' });
    res.json({ code: 0, data: { totalAmount: '3286.00', count: 4, earliest: '今天 09:12', todayPaid: '1710.60', monthPaid: '42380.00', failedCount: 1 } });
  });

  /** 开发者首页：今日处理概览（系统视角，无金额） */
  app.get('/api/v1/core/insights/dev-summary', ...guard, (_req, res) => {
    res.json({
      code: 0,
      data: {
        processedToday: 12406, queueBacklog: 0, syncTasks: 2, patrols: 6, failures24h: 0,
        lastFailure: '10-12 红果接口超时（已自动重试成功）',
        weekImports: 6, weekPatrols: 24, weekFixes: 2,
      },
    });
  });

  /** 开发者首页：处理量日序列（业绩条数，按日） */
  app.get('/api/v1/core/insights/dev-daily', ...guard, (req, res) => {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    res.json({ code: 0, data: { labels: dailySeries(days, 0, 0).map(d => d.date), values: dailySeries(days, 9000, 2400, 0.3).map(d => d.value) } });
  });

  /** 开发者首页：Worker 状态 */
  app.get('/api/v1/core/insights/dev-workers', ...guard, (_req, res) => {
    res.json({
      code: 0,
      data: {
        list: [
          { name: '知乎同步', note: '3 分钟前', ok: true },
          { name: '红果同步', note: '11 分钟前', ok: true },
          { name: '收益计算队列', note: '0 条积压', ok: true },
          { name: '归属一致性巡检', note: '0 条差异', ok: true },
        ],
      },
    });
  });

  /** 开发者首页：任务动态 */
  app.get('/api/v1/core/insights/dev-activity', ...guard, (_req, res) => {
    res.json({
      code: 0,
      data: {
        list: [
          { title: '知乎同步完成', detail: '15:06 · 182 条', tone: 'ok' },
          { title: '归属巡检通过', detail: '15:00 · 0 差异', tone: 'info' },
          { title: '报表导入完成', detail: '14:48 · 382 行', tone: 'clay' },
          { title: '红果同步重试成功', detail: '11:12 · 1 次重试', tone: 'muted' },
        ],
      },
    });
  });

  /** 巡检中心：一致性检查卡片 + 巡检记录 */
  const inspectionRecords = () => {
    const now = new Date();
    const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
    return [
      { time: hh(now.getHours()), item: '归属一致性', duration: '42s', result: '通过', diffs: '0 条' },
      { time: hh(now.getHours()), item: '金额完整性', duration: '38s', result: '通过', diffs: '0 条' },
      { time: hh(now.getHours() - 1), item: '重复业绩', duration: '12s', result: '通过', diffs: '0 条' },
      { time: hh(now.getHours() - 1), item: '关系环检测', duration: '8s', result: '通过', diffs: '0 个' },
      { time: hh(now.getHours() - 2), item: '单价覆盖', duration: '6s', result: '通过', diffs: '0 条' },
    ];
  };
  app.get('/api/v1/core/insights/dev-inspections', ...guard, (_req, res) => {
    res.json({
      code: 0,
      data: {
        cards: [
          { name: '归属一致性', diffs: 0, unit: '条差异', note: '每小时巡检 · 最近 15:00' },
          { name: '金额完整性', diffs: 0, unit: '条差异', note: '收益行与打款逐笔勾稽' },
          { name: '关系环检测', diffs: 0, unit: '个环', note: '邀请链与团队归属无循环' },
        ],
        records: inspectionRecords(),
      },
    });
  });

  /** 巡检中心：立即重跑（演示：记录时间刷新为当前整点） */
  app.post('/api/v1/core/insights/dev-inspections/run', ...guard, (_req, res) => {
    res.json({ code: 0, data: { records: inspectionRecords(), ranAt: new Date().toISOString() } });
  });

  /** 任务队列 */
  app.get('/api/v1/core/insights/dev-queue', ...guard, (_req, res) => {
    res.json({
      code: 0,
      data: {
        backlog: 0, successRate: '100%',
        rows: [
          { task: '知乎同步 · 10-19', type: '同步', at: '15:06', status: '完成', duration: '4.2s' },
          { task: '归属一致性巡检', type: '巡检', at: '15:00', status: '完成', duration: '42s' },
          { task: '红果 10-19 回传入库', type: '回传', at: '14:58', status: '完成', duration: '2.8s' },
          { task: '收益重算 · 唐南乔晋升', type: '重算', at: '14:26', status: '完成', duration: '1.6s' },
          { task: '红果同步重试', type: '同步', at: '11:12', status: '重试后成功', duration: '12s' },
        ],
      },
    });
  });
}
