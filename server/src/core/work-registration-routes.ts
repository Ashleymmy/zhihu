import { Router } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { assertDataScope } from './accounts';
import { canViewWorkStatistics } from '../auth/roles';
import type { ModuleRuntime } from './module-runtime';
import type { KeywordBindingRow, WorkRegistrationReport } from './contracts';

const id = z.string().regex(/^[1-9]\d*$/);
const query = z
  .object({
    moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    projectId: id,
    accountId: id,
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    search: z.string().trim().max(200).optional(),
    ownerId: id.optional(),
    planId: id.optional(),
    view: z.enum(['self', 'team', 'all']).optional(),
    result: z.enum(['submitted', 'failed', 'pending']).optional(),
    registeredOnly: z
      .enum(['1', 'true', '0', 'false'])
      .optional()
      .transform((v) => v === '1' || v === 'true'),
    successfulOnly: z
      .enum(['1', 'true', '0', 'false'])
      .default('0')
      .transform((v) => v === '1' || v === 'true'),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '开始日期不能晚于结束日期' });

export function registrationWorkbook(report: WorkRegistrationReport): Buffer {
  const workbook = XLSX.utils.book_new();
  const daily = XLSX.utils.aoa_to_sheet([
    ['登记日期（北京时间）', '作品数量'],
    ...report.daily.map((d) => [d.date, d.count]),
    ['合计', report.total],
  ]);
  daily['!cols'] = [{ wch: 26 }, { wch: 16 }];
  const detail = XLSX.utils.aoa_to_sheet([
    [
      '首次回传时间（北京时间）',
      '关键词',
      '作品名称',
      '提交人',
      '发布平台',
      '发布账号',
      '回传链接',
      '发布时间（北京时间）',
      '登记状态',
      '审核状态',
      '推广活动',
      '作品编号',
      '推广计划名称',
      '作品分类',
      '作品子分类',
      '原著小说名',
      '原著链接',
      '提交账号',
      '提交人ID',
      '团长名',
      '团长账号',
      '团长ID',
      '归属说明',
      '失败原因',
    ],
    ...report.rows.map((r) => [
      r.registeredAt,
      r.keyword,
      r.title,
      r.performerName,
      r.mediaType,
      r.mediaAccount,
      r.workUrl,
      r.publishedAt,
      r.registrationStatus,
      r.reviewStatus,
      r.taskName,
      r.id,
      r.planName,
      r.category,
      r.subcategory,
      r.novelTitle,
      r.novelUrl,
      r.performerAccount,
      r.performerId,
      r.leaderName,
      r.leaderAccount,
      r.leaderId,
      r.relationNote,
      r.failureReason,
    ]),
  ]);
  // Strings remain typed strings, including leading =/+ and long identifiers. No formulas from user input.
  report.rows.forEach((row, index) => {
    if (/^https?:\/\//i.test(row.workUrl)) detail[`G${index + 2}`].l = { Target: row.workUrl };
    if (/^https?:\/\//i.test(row.novelUrl)) detail[`Q${index + 2}`].l = { Target: row.novelUrl };
  });
  detail['!cols'] = [
    24, 22, 32, 20, 20, 24, 65, 24, 20, 22, 25, 20, 28, 16, 16, 28, 65, 24, 20, 20, 24, 20, 48, 48,
  ].map((wch) => ({ wch }));
  detail['!autofilter'] = { ref: `A1:X${report.rows.length + 1}` };
  XLSX.utils.book_append_sheet(workbook, daily, '每日汇总');
  XLSX.utils.book_append_sheet(workbook, detail, '作品明细');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

export function createWorkRegistrationRouter(runtime: ModuleRuntime) {
  const router = Router();
  for (const path of ['/', '/export'])
    router.get(
      path,
      asyncHandler(async (req, res) => {
        if (!canViewWorkStatistics(req.user.role))
          throw new AppError(403, 40300, '仅管理员和开发者可查看作品统计及导出');
        const q = query.parse(req.query);
        await assertDataScope(req.user, q.projectId, q.accountId, q.moduleId);
        const module = runtime.get(q.moduleId);
        if (!module || !module.manifest.roles.includes(req.user.role)) throw new AppError(404, 40400, '项目暂不可用');
        if (!module.dataProvider?.workRegistrations) throw new AppError(404, 40400, '该项目暂未提供作品登记统计');
        const report = await module.dataProvider.workRegistrations(q, req.user, q, path === '/export');
        // Include empty days for ordinary date ranges; very long/all-time reports stay sparse.
        if (q.from && q.to) {
          const from = Date.parse(q.from + 'T00:00:00Z'),
            to = Date.parse(q.to + 'T00:00:00Z');
          if ((to - from) / 86400000 < 3660) {
            const counts = new Map(report.daily.map((day) => [day.date, day.count]));
            report.daily = [];
            for (let day = to; day >= from; day -= 86400000) {
              const date = new Date(day).toISOString().slice(0, 10);
              report.daily.push({ date, count: counts.get(date) || 0 });
            }
          }
        }
        res.setHeader('Cache-Control', 'no-store');
        if (path === '/') {
          ok(res, { total: report.total, daily: report.daily });
          return;
        }
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .attachment(`作品回传_${q.from || '全部'}_${q.to || '至今'}.xlsx`)
          .send(registrationWorkbook(report));
      }),
    );
  return router;
}

const keywordQuery = z
  .object({
    moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    projectId: id,
    accountId: id,
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '开始日期不能晚于结束日期' });

export function keywordBindingWorkbook(rows: KeywordBindingRow[]): Buffer {
  const columns: [keyof KeywordBindingRow, string, number][] = [
    ['boundAt', '绑定时间（北京时间）', 24],
    ['createdAt', '创建时间（北京时间）', 24],
    ['dateBasis', '日期收录依据', 36],
    ['taskName', '推广活动', 28],
    ['channelName', '渠道', 24],
    ['keyword', '关键词', 24],
    ['novelTitle', '原著书名', 28],
    ['novelUrl', '原著链接', 65],
    ['creatorAccount', '创建账号', 24],
    ['creatorName', '创建人', 20],
    ['creatorId', '创建人ID', 20],
    ['creatorLeaderName', '创建人使用该词时的团长', 28],
    ['performerAccount', '使用账号', 24],
    ['performerName', '使用人', 20],
    ['performerId', '使用人ID', 20],
    ['leaderName', '本次归属团长', 20],
    ['leaderAccount', '团长账号', 24],
    ['leaderId', '团长ID', 20],
    ['relationNote', '归属说明', 55],
    ['creationStatus', '创建状态', 20],
    ['failureReason', '失败原因', 48],
    ['bindingStatus', '分配状态', 28],
    ['id', '关键词计划编号', 22],
    ['bindingId', '领取分配记录编号', 22],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([columns.map((c) => c[1]), ...rows.map((r) => columns.map((c) => r[c[0]]))]);
  rows.forEach((row, i) => {
    if (/^https?:\/\//i.test(row.novelUrl)) sheet[`H${i + 2}`].l = { Target: row.novelUrl };
  });
  sheet['!cols'] = columns.map((c) => ({ wch: c[2] }));
  sheet['!autofilter'] = { ref: `A1:X${rows.length + 1}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '关键词绑定明细');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

export function createKeywordBindingRouter(runtime: ModuleRuntime) {
  const router = Router();
  router.get(
    '/export',
    asyncHandler(async (req, res) => {
      if (!canViewWorkStatistics(req.user.role)) throw new AppError(403, 40300, '仅管理员和开发者可导出关键词记录');
      const q = keywordQuery.parse(req.query);
      await assertDataScope(req.user, q.projectId, q.accountId, q.moduleId);
      const module = runtime.get(q.moduleId);
      if (!module || !module.manifest.roles.includes(req.user.role)) throw new AppError(404, 40400, '项目暂不可用');
      if (!module.dataProvider?.keywordBindings) throw new AppError(404, 40400, '该项目暂未提供关键词导出');
      const rows = await module.dataProvider.keywordBindings(q, req.user, q);
      res.setHeader('Cache-Control', 'no-store');
      res
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .attachment(`关键词绑定_${q.from || '全部'}_${q.to || '至今'}.xlsx`)
        .send(keywordBindingWorkbook(rows));
    }),
  );
  return router;
}
