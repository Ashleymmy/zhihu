import { Router } from 'express';
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db';
import { AppError, asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import { assertEvidenceAccess } from './evidence';
import {
  settlementBaseSchema,
  settlementId,
  settlementKey,
  settlementPage,
  settlementReceipt,
  commentView,
} from './settlements';
import type { ModuleRuntime } from './module-runtime';
import type { AuthUser } from '../types';

const contextSchema = settlementBaseSchema.extend({
  channelRef: settlementId,
  taskRef: settlementId,
  businessDate: z.string().date(),
  metricType: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
});
type Context = z.infer<typeof contextSchema>;
async function comments(
  runtime: ModuleRuntime,
  user: AuthUser,
  context: Context,
  options: { page?: number; pageSize?: number; body?: string; requestKey?: string },
) {
  return withTransaction(async (c) => {
    const scope = {
      projectId: context.projectId,
      accountId: context.accountId,
      from: context.businessDate,
      to: context.businessDate,
    };
    const actor = await assertEvidenceAccess(c, user, scope, context.moduleId);
    // This is a separate nonfinancial thread. Validate its real business key through the existing provider contract.
    const module = runtime.get(context.moduleId);
    if (!module?.manifest.roles.includes(actor.role) || !module.dataProvider?.evidenceInTransaction)
      throw new AppError(503, 50300, '该项目暂未接通业务留言，请稍后重试');
    const evidence = await module.dataProvider.evidenceInTransaction(c, scope, actor, {
      channelRef: context.channelRef,
      taskRef: context.taskRef,
      metricType: context.metricType,
      page: 1,
      pageSize: 1,
    });
    if (!evidence.list.length) throw new AppError(404, 40400, '这条业务记录不可查看，请重新打开记录');
    const key = evidence.list[0].key;
    if (
      evidence.moduleId !== context.moduleId ||
      evidence.list.length !== 1 ||
      key.projectId !== context.projectId ||
      key.accountId !== context.accountId ||
      key.channelRef !== context.channelRef ||
      key.taskRef !== context.taskRef ||
      key.businessDate !== context.businessDate ||
      key.metricType !== context.metricType
    )
      throw new AppError(502, 50200, '暂时无法核对留言关联记录，请重试');
    const args = [
      context.moduleId,
      context.projectId,
      context.accountId,
      context.taskRef,
      context.channelRef,
      context.businessDate,
      context.metricType,
    ];
    const where =
      "cm.module_id=? AND cm.project_id=? AND cm.account_id=? AND cm.context_kind='evidence' AND cm.leader_id IS NULL AND cm.context_id=? AND cm.channel_ref=? AND cm.business_date=? AND cm.metric_type=?";
    const select =
      "SELECT CAST(cm.id AS CHAR) id,CAST(cm.author_id AS CHAR) author_id,u.display_name,cm.body,DATE_FORMAT(cm.created_at,'%Y-%m-%d %H:%i:%s') created_at FROM opc_record_comments cm JOIN users u ON u.id=cm.author_id";
    if (options.body !== undefined)
      return settlementReceipt(
        c,
        actor,
        'business_comment',
        options.requestKey!,
        { context, body: options.body },
        async () => {
          const [made] = await c.query<ResultSetHeader>(
            "INSERT INTO opc_record_comments(module_id,project_id,account_id,context_kind,context_id,channel_ref,business_date,metric_type,author_id,body) VALUES(?,?,?,'evidence',?,?,?,?,?,?)",
            [...args, actor.sub, options.body],
          );
          const [[row]] = await c.query<RowDataPacket[]>(`${select} WHERE cm.id=? AND ${where}`, [
            String(made.insertId),
            ...args,
          ]);
          return commentView(row);
        },
      );
    const page = options.page ?? 1,
      pageSize = options.pageSize ?? 25;
    const [[count]] = await c.query<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM opc_record_comments cm WHERE ${where}`,
      args,
    );
    const [list] = await c.query<RowDataPacket[]>(`${select} WHERE ${where} ORDER BY cm.id LIMIT ? OFFSET ?`, [
      ...args,
      pageSize,
      (page - 1) * pageSize,
    ]);
    return { list: list.map(commentView), total: Number(count.total), page, pageSize };
  });
}
export function createRecordCommentRouter(runtime: ModuleRuntime) {
  const r = Router();
  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const { page, pageSize, ...context } = contextSchema.extend(settlementPage).strict().parse(req.query);
      ok(res, await comments(runtime, req.user, context, { page, pageSize }));
    }),
  );
  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const { body, requestKey, ...context } = contextSchema
        .extend({ body: z.string().trim().min(1).max(2000), requestKey: settlementKey })
        .strict()
        .parse(req.body);
      ok(res, await comments(runtime, req.user, context, { body, requestKey }), 201);
    }),
  );
  return r;
}
