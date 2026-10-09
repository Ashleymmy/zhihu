import { isStaffRole } from '../../../auth/roles';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../../auth/middleware';
import { asyncHandler, AppError } from '../../../middleware/errors';
import { ok } from '../../../utils/response';
import {getAgency,setAgency} from '../attribution/agency';
import * as resource from '../attribution/resources';

import * as facts from '../attribution/facts';
import * as statements from '../attribution/statements';
import { fail } from '../attribution/domain';
import * as cutover from '../attribution/cutover';
import * as workbench from '../attribution/workbench';
import { assignRetro } from '../attribution/retro-assignment';
import { historicalWorks } from '../attribution/historical-works';
import { recordExecutionHistory } from '../attribution/execution-history';
import { reviewRisk } from '../attribution/risk-review';
import { importAnalysis, answerImportAnalysis } from '../attribution/analysis';
import { listWorks, workActivity, workDetail } from '../attribution/works';
import { assertDuty } from '../../../core/duties';
import { requirePermission } from '../permissions';
import { XLSX_MAX_BYTES } from '../zhihu/allianceXlsx';
import { novelSchema } from '../attribution/novel';

export const attributionRouter = Router();
const engineGroups = new Set([
  'workbench',
  'project-agency',
  'attribution-options',
  'channel-mappings',
  'keywords',
  'bindings',
  'price-agreements',
  'price-versions',
  'imports',
  'metric-revisions',
  'attributions',
  'exceptions',
  'evidence',
  'evidence-bindings',
  'statements',
  'engine-route',
  'legacy-inventory',
]);
// 根路由挂载时，只认证本引擎的入口，避免拦住知乎模块既有的签名回调。
attributionRouter.use((req, res, next) =>
  engineGroups.has(req.path.split('/')[1]) ? requireAuth(req, res, next) : next('router'),
);
attributionRouter.use(requirePermission('attribution.read'));
attributionRouter.use((req,_res,next)=>{
 if(!isStaffRole(req.user.role)||['GET','HEAD'].includes(req.method))return next();
 try {
  const group=req.path.split('/')[1];
  // Each analysis question enforces its own duty in the service transaction.
  if(group==='project-agency')return next();
  if(group==='imports'&&/^\/imports\/\d+\/answers$/.test(req.path))return next();
  assertDuty(req.user,['imports','metric-revisions','statements'].includes(group)||group==='workbench'&&['import','confirm'].includes(req.path.split('/')[2])?'finance':'operations');
  next();
 }catch(e){next(e)}
});
attributionRouter.get(
  '/engine-route',
  asyncHandler(async (req, res) => ok(res, await cutover.getRoute(req.user, scopeSchema.parse(req.query)))),
);
attributionRouter.post(
  '/engine-route',
  requirePermission('engine.configure'),
  asyncHandler(async (req, res) => {
    const q = scopeSchema
      .extend({
        from: z.string().date(),
        mode: z.enum(['trial', 'enabled', 'stopped']),
        reason: z.string().trim().min(1).max(1000),
        sampleVerified: z.boolean(),
      })
      .parse(req.body);
    ok(res, await cutover.configureRoute(req.user, q, q));
  }),
);
attributionRouter.get(
  '/legacy-inventory',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.merge(pagingSchema).parse(req.query);
    ok(res, await cutover.legacyInventory(req.user, q, q.page, q.pageSize));
  }),
);
export const idSchema = z.string().regex(/^\d+$/);
export const scopeSchema = z.object({ projectId: idSchema, accountId: idSchema });
export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const key = (req: import('express').Request) => req.header('Idempotency-Key') ?? String(req.body?.requestKey ?? '');
attributionRouter.get('/project-agency',asyncHandler(async(req,res)=>ok(res,await getAgency(req.user,scopeSchema.parse(req.query)))));
attributionRouter.post('/project-agency',asyncHandler(async(req,res)=>{const q=scopeSchema.extend({name:z.string().trim().min(1).max(200),expected:z.string().max(200).nullable()}).parse(req.body);ok(res,await setAgency(req.user,q,key(req),q.name,q.expected));}));
const workFiltersSchema=scopeSchema.merge(pagingSchema).extend({
  from:z.string().date().optional(),to:z.string().date().optional(),
  view:z.enum(['self','team','all']).optional(),ownerId:idSchema.optional(),
  registeredOnly:z.enum(['1','true']).optional().transform(v=>!!v),
  result:z.enum(['submitted','failed','pending']).optional(),
}).refine(q=>!q.from||!q.to||q.from<=q.to,{message:'开始日期不能晚于结束日期'});
attributionRouter.get('/workbench/work-activity',asyncHandler(async(req,res)=>{
  const q=workFiltersSchema.parse(req.query);ok(res,await workActivity(req.user,q,q,q.page,q.pageSize));
}));
attributionRouter.get('/workbench/work-detail',asyncHandler(async(req,res)=>{
  const q=scopeSchema.extend({id:z.string().regex(/^(composition:)?[0-9]+$/)}).parse(req.query);
  ok(res,await workDetail(req.user,q,q.id));
}));
attributionRouter.get('/workbench/works', asyncHandler(async (req, res) => {
  const query = workFiltersSchema.parse(req.query);
  ok(res, await listWorks(req.user, query, query.page, query.pageSize,query));
}));
attributionRouter.get(
  '/attribution-options',
  asyncHandler(async (req, res) => ok(res, await resource.options(req.user, scopeSchema.parse(req.query)))),
);
attributionRouter.post(
  '/keywords/:id/retry-upstream',
  asyncHandler(async (req, res) =>
    ok(
      res,
      await resource.retryKeyword(req.user, scopeSchema.parse(req.body), idSchema.parse(req.params.id), key(req)),
    ),
  ),
);
attributionRouter.post(
  '/channel-mappings',
  asyncHandler(async (req, res) => {
    const input = scopeSchema
      .extend({
        channelId: idSchema,
        name: z.string().trim().min(1).max(255),
        from: z.string().date(),
        to: z.string().date().optional(),
        canonicalId: idSchema.optional(),
      })
      .parse(req.body);
    ok(res, await resource.createMapping(req.user, input, key(req), input), 201);
  }),
);
attributionRouter.get(
  '/keywords',
  asyncHandler(async (req, res) => {
    const query = scopeSchema
      .merge(pagingSchema)
      .extend({ search: z.string().max(128).default(''), view: z.enum(['all','available','owned','ongoing','registered','retired']).default('all') })
      .parse(req.query);
    ok(res, await resource.listKeywords(req.user, query, query.page, query.pageSize, query.search, query.view));
  }),
);
attributionRouter.post(
  '/keywords',
  requirePermission('keyword.create'),
  asyncHandler(async (req, res) => {
    const input = scopeSchema
      .extend({
        keyword: z.string().max(128),
        taskId: idSchema,
        mappingId: idSchema.optional(),
        channelId: idSchema.optional(),
        landingUrl: z.string().url().max(1024),
        novel: novelSchema.optional(),
        popularizeType: z.literal(0),
      })
      .parse(req.body);
    ok(res, await resource.createKeyword(req.user, input, key(req), input), 201);
  }),
);
attributionRouter.post('/keywords/:id/edit-retry',requirePermission('keyword.create'),asyncHandler(async(req,res)=>{
  const input=scopeSchema.extend({keyword:z.string().trim().min(1).max(128),taskId:idSchema.optional(),mappingId:idSchema.optional(),channelId:idSchema.optional(),landingUrl:z.string().url().max(1024).optional(),popularizeType:z.literal(0).optional(),novel:novelSchema.optional()}).parse(req.body);
  const {projectId,accountId,keyword,...patch}=input;
  ok(res,await resource.editFailedKeyword(req.user,{projectId,accountId},idSchema.parse(req.params.id),key(req),keyword,patch));
}));
attributionRouter.post('/keywords/:id/copy-retry',requirePermission('keyword.create'),asyncHandler(async(req,res)=>{
  const input=scopeSchema.extend({keyword:z.string().trim().min(1).max(128),taskId:idSchema.optional(),mappingId:idSchema.optional(),channelId:idSchema.optional(),landingUrl:z.string().url().max(1024).optional(),popularizeType:z.literal(0).optional(),novel:novelSchema.optional()}).parse(req.body);
  const {projectId,accountId,keyword,...patch}=input;
  ok(res,await resource.copyFailedKeyword(req.user,{projectId,accountId},idSchema.parse(req.params.id),key(req),keyword,patch),201);
}));
attributionRouter.post('/keywords/:id/novel',requirePermission('keyword.create'),asyncHandler(async(req,res)=>{
  const input=scopeSchema.extend({novel:novelSchema}).parse(req.body);
  ok(res,await resource.updateKeywordNovel(req.user,input,z.string().regex(/^(plan:)?\d+$/).parse(req.params.id),key(req),input.novel));
}));
attributionRouter.post('/keywords/:id/delete-failed',requirePermission('keyword.create'),asyncHandler(async(req,res)=>{
  ok(res,await resource.deleteFailedKeyword(req.user,scopeSchema.parse(req.body),idSchema.parse(req.params.id),key(req)));
}));
attributionRouter.post(
  '/keywords/:id/claim',
  asyncHandler(async (req, res) =>
    ok(res, await resource.claim(req.user, scopeSchema.parse(req.body), idSchema.parse(req.params.id), key(req))),
  ),
);
attributionRouter.post(
  '/keywords/:id/confirm-upstream',
  asyncHandler(async (req, res) => {
    const input = scopeSchema.extend({ reason: z.string().trim().min(1).max(500) }).parse(req.body);
    ok(res, await resource.confirmUpstream(req.user, input, idSchema.parse(req.params.id), key(req), input.reason));
  }),
);
attributionRouter.post(
  '/bindings/:id/:action',
  asyncHandler(async (req, res) => {
    const scope = scopeSchema.parse(req.body);
    const input = z
      .object({
        action: z.enum(['assign', 'activate', 'request-release', 'release', 'stop']),
        executorId: idSchema.optional(),
        reason: z.string().max(500).optional(),
      })
      .parse({ ...req.body, action: req.params.action });
    ok(res, await resource.changeBinding(req.user, scope, idSchema.parse(req.params.id), key(req), input));
  }),
);
const retiredMemberPrices:import('express').RequestHandler=(req,_res,next)=>{
  try { if(isStaffRole(req.user.role))assertDuty(req.user,'finance');throw new AppError(410,41000,'成员报价已停用，请在平台计费规则中查看和设置角色单价'); }catch(error){next(error)}
};
attributionRouter.get('/price-agreements',retiredMemberPrices);
attributionRouter.post('/price-agreements',retiredMemberPrices);
attributionRouter.post('/price-versions/:id/publish',retiredMemberPrices);
const multipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: XLSX_MAX_BYTES, files: 1, fields: 5, parts: 6 },
}).single('file');
const upload: import('express').RequestHandler = (req, res, next) =>
  multipart(req, res, (error) =>
    next(error instanceof multer.MulterError ? new AppError(422, 42200, '上传文件超过大小或字段数量限制') : error),
  );
attributionRouter.post(
  '/imports',
  upload,
  asyncHandler(async (req, res) => {
    const q = scopeSchema.extend({ reportKind: z.enum(['search', 'order', 'combined', 'activation']) }).parse(req.body);
    if (!req.file) fail('缺少报告文件');
    ok(res, await facts.previewImport(req.user, q, req.file, q.reportKind), 201);
  }),
);
attributionRouter.get(
  '/imports',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.merge(pagingSchema).parse(req.query);
    ok(res, await facts.listImports(req.user, q, q.page, q.pageSize));
  }),
);
attributionRouter.get(
  '/imports/:id',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.merge(pagingSchema).parse(req.query);
    ok(res, await facts.importDetail(req.user, q, idSchema.parse(req.params.id), q.page, q.pageSize));
  }),
);
attributionRouter.get(
  '/imports/:id/file',
  asyncHandler(async (req, res) => {
    const f = await facts.originalFile(req.user, scopeSchema.parse(req.query), idSchema.parse(req.params.id));
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(f.name).send(f.bytes);
  }),
);
attributionRouter.get('/imports/:id/analysis',asyncHandler(async(req,res)=>{
  ok(res,await importAnalysis(req.user,scopeSchema.parse(req.query),idSchema.parse(req.params.id)));
}));
attributionRouter.post('/imports/:id/answers',asyncHandler(async(req,res)=>{
  const selection=z.union([z.object({channelId:idSchema}).strict(),z.object({mappingId:idSchema}).strict(),z.object({keywordId:idSchema}).strict(),
    z.object({upstreamId:z.string().trim().min(1).max(32),generation:z.union([z.literal(1),z.literal(2)])}).strict(),
    z.object({taskId:idSchema,executorId:idSchema,fromDate:z.string().date().optional()}).strict()]);
  const q=scopeSchema.extend({askId:z.string().min(1).max(160),option:z.string().min(1).max(160),selection:selection.optional()}).parse(req.body);
  ok(res,await answerImportAnalysis(req.user,q,idSchema.parse(req.params.id),key(req),q.askId,q.option,q.selection));
}));
attributionRouter.post(
  '/imports/:id/commit',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.extend({ previewHash: z.string().length(64) }).parse(req.body);
    const id = idSchema.parse(req.params.id);
    await facts.commitImport(req.user, q, id, key(req), q.previewHash);
    ok(res, await facts.processBatch(req.user, q, id), 202);
  }),
);
attributionRouter.post(
  '/imports/:id/process',
  asyncHandler(async (req, res) => {
    const scope = scopeSchema.parse(req.body),
      id = idSchema.parse(req.params.id);
    await facts.requeueImport(req.user, scope, id, key(req));
    ok(res, await facts.processBatch(req.user, scope, id), 202);
  }),
);
attributionRouter.get(
  '/attributions',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.merge(pagingSchema).parse(req.query);
    ok(res, await facts.listAttributions(req.user, q, q.page, q.pageSize));
  }),
);
attributionRouter.get(
  '/attributions/:id/trace',
  asyncHandler(async (req, res) =>
    ok(res, await facts.trace(req.user, scopeSchema.parse(req.query), idSchema.parse(req.params.id))),
  ),
);
attributionRouter.post(
  '/attributions/:id/recompute',
  asyncHandler(async (req, res) =>
    ok(res, await facts.recompute(req.user, scopeSchema.parse(req.body), idSchema.parse(req.params.id))),
  ),
);
attributionRouter.get(
  '/exceptions',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.merge(pagingSchema).extend({factId:idSchema.optional(),status:z.enum(['all','open','done']).default('all'),search:z.string().trim().max(128).default('')}).parse(req.query);
    ok(res, await facts.listExceptions(req.user, q, q.page, q.pageSize,q.factId,q));
  }),
);
attributionRouter.post(
  '/exceptions/:id/retry',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.extend({ reason: z.string().trim().min(1).max(500) }).parse(req.body);
    const r = await facts.retryException(req.user, q, idSchema.parse(req.params.id), key(req), q.reason);
    ok(res, await facts.processBatch(req.user, q, r.batchId));
  }),
);
attributionRouter.post(
  '/metric-revisions/:id/resolve',
  asyncHandler(async (req, res) => {
    const q = scopeSchema
      .extend({
        expectedRevisionId: idSchema.nullable(),
        reason: z.string().trim().min(1).max(500),
        accept: z.boolean(),
      })
      .parse(req.body);
    ok(
      res,
      await facts.acceptRevision(
        req.user,
        q,
        idSchema.parse(req.params.id),
        key(req),
        q.expectedRevisionId,
        q.reason,
        q.accept,
      ),
    );
  }),
);
attributionRouter.post(
  '/metric-revisions/:id/rebase',
  asyncHandler(async (req, res) => {
    const q = scopeSchema
      .extend({ expectedRevisionId: idSchema, reason: z.string().trim().min(1).max(500) })
      .parse(req.body);
    ok(
      res,
      await facts.rebaseRevision(req.user, q, idSchema.parse(req.params.id), key(req), q.expectedRevisionId, q.reason),
    );
  }),
);
attributionRouter.get('/evidence/historical-tasks',asyncHandler(async(req,res)=>{
 const q=scopeSchema.merge(pagingSchema).extend({batchId:idSchema.optional(),keywordId:idSchema.optional(),search:z.string().trim().max(128).optional()}).parse(req.query);
 ok(res,await historicalWorks(req.user,q,q));
}));
attributionRouter.post('/attributions/:id/risk-review',asyncHandler(async(req,res)=>{
 const q=scopeSchema.extend({expectedRevisionId:idSchema,decision:z.enum(['accepted','excluded']),reason:z.string().trim().min(1).max(500)}).parse(req.body);
 ok(res,await reviewRisk(req.user,q,idSchema.parse(req.params.id),key(req),q));
}));
attributionRouter.get(
  '/evidence',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.merge(pagingSchema).parse(req.query);
    ok(res, await statements.listEvidence(req.user, q, q.page, q.pageSize));
  }),
);
attributionRouter.post(
  '/evidence',
  asyncHandler(async (req, res) => {
    const q = scopeSchema
      .extend({ bindingId: idSchema, url: z.string().url().max(2048), description: z.string().trim().min(1).max(1000) })
      .parse(req.body);
    ok(res, await statements.submitEvidence(req.user, q, key(req), q), 201);
  }),
);
attributionRouter.post(
  '/evidence/:id/review',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.extend({ accept: z.boolean(), reason: z.string().trim().min(1).max(500) }).parse(req.body);
    ok(res, await statements.reviewEvidence(req.user, q, idSchema.parse(req.params.id), key(req), q.accept, q.reason));
  }),
);
attributionRouter.post(
  '/evidence-bindings/:id/dispute',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.extend({ resolve: z.boolean(), reason: z.string().trim().min(1).max(500) }).parse(req.body);
    ok(res, await statements.disputeBinding(req.user, q, idSchema.parse(req.params.id), key(req), q.resolve, q.reason));
  }),
);
attributionRouter.get(
  '/statements',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.merge(pagingSchema).parse(req.query);
    ok(res, await statements.listStatements(req.user, q, q.page, q.pageSize));
  }),
);
attributionRouter.post(
  '/statements/preview',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.extend({ factId: idSchema }).parse(req.body);
    ok(res, await statements.previewStatement(req.user, q, key(req), q.factId), 201);
  }),
);
attributionRouter.post(
  '/statements/preview-period',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.extend({ from: z.string().date(), to: z.string().date() }).parse(req.body);
    ok(res, await statements.previewPeriod(req.user, q, key(req), q), 201);
  }),
);
attributionRouter.post(
  '/statements/confirm-batch',
  asyncHandler(async (req, res) => {
    const q = scopeSchema
      .extend({
        entries: z
          .array(z.object({ id: idSchema, expectedHash: z.string().length(64) }))
          .min(1)
          .max(100),
      })
      .parse(req.body);
    ok(res, await statements.confirmBatch(req.user, q, key(req), q.entries));
  }),
);
attributionRouter.post(
  '/statements/:id/confirm',
  asyncHandler(async (req, res) => {
    const q = scopeSchema.extend({ expectedHash: z.string().length(64) }).parse(req.body);
    ok(res, await statements.confirmStatement(req.user, q, idSchema.parse(req.params.id), key(req), q.expectedHash));
  }),
);

const periodSchema=scopeSchema.extend({from:z.string().date(),to:z.string().date(),viewVersion:z.enum(['1','2']).default('1')});
const billPeriod=(q:z.infer<typeof periodSchema>):workbench.Period=>({from:q.from,to:q.to,...(q.viewVersion==='1'?{metricType:'new_user' as const}:{})});
attributionRouter.get('/workbench',asyncHandler(async(req,res)=>{
 if(isStaffRole(req.user.role))assertDuty(req.user,'finance');const q=periodSchema.parse(req.query);
 const view=await workbench.overview(req.user,q,billPeriod(q));
 // Old clients format null as zero and cannot label activation. Keep their bill
 // and confirmation scope on new-user money; preserve unresolved data separately.
 ok(res,q.viewVersion==='1'?{...view,entries:view.entries.filter(e=>e.amount!==null),pendingEntries:view.entries.filter(e=>e.amount===null)}:view);
}));
attributionRouter.post('/workbench/import',upload,asyncHandler(async(req,res)=>{const q=scopeSchema.extend({reportType:z.enum(['new_user','activation']).default('new_user')}).parse(req.body);if(!req.file)fail('请选择知乎 Excel 报表');ok(res,await workbench.uploadReport(req.user,q,req.file,q.reportType),202);}));
attributionRouter.post('/workbench/confirm',asyncHandler(async(req,res)=>{
 const q=periodSchema.extend({reviewHash:z.string().length(64),acknowledged:z.literal(true),requestKey:z.string().regex(/^[\w.-]{8,110}$/)}).parse(req.body);
 ok(res,await workbench.confirmBills(req.user,q,billPeriod(q),q.requestKey,q.reviewHash));
}));
attributionRouter.post('/keywords/:id/distribute',asyncHandler(async(req,res)=>{
 const q=scopeSchema.extend({targetId:idSchema}).parse(req.body);ok(res,await resource.distribute(req.user,q,idSchema.parse(req.params.id),key(req),q.targetId));
}));
attributionRouter.post('/keywords/:id/assign-retro',asyncHandler(async(req,res)=>{
 const q=scopeSchema.extend({executorId:idSchema,fromDate:z.string().date().optional()}).parse(req.body);
 ok(res,await assignRetro(req.user,q,idSchema.parse(req.params.id),key(req),q));
}));
attributionRouter.post('/keywords/:id/execution-history',asyncHandler(async(req,res)=>{
 const q=scopeSchema.extend({bindingId:idSchema,fromDate:z.string().date(),url:z.string().url().max(2048),description:z.string().trim().min(1).max(1000)}).parse(req.body);
 ok(res,await recordExecutionHistory(req.user,q,idSchema.parse(req.params.id),key(req),q));
}));
