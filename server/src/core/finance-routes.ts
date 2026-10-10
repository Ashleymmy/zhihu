import {Router} from 'express';
import multer from 'multer';
import {z} from 'zod';
import {asyncHandler,AppError} from '../middleware/errors';
import {ok} from '../utils/response';
import * as f from './finance';
const scope=z.object({moduleId:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),projectId:z.string().regex(/^\d+$/),accountId:z.string().regex(/^\d+$/)});
const id=z.string().regex(/^\d+$/),key=z.string().regex(/^[\w.-]{8,128}$/);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:20}}).single('proof');
export const financeRouter=Router();
financeRouter.get('/',asyncHandler(async(req,res)=>{if(!req.query.moduleId&&!req.query.projectId&&!req.query.accountId){ok(res,{status:'requires_scope',message:'请选择业务项目后查看收入、提现和付款记录'});return;}const q=scope.extend({page:z.coerce.number().int().min(1).default(1)}).parse(req.query);ok(res,await f.financeOverview(req.user,q,q.page));}));
financeRouter.post('/funding',asyncHandler(async(req,res)=>{const q=scope.extend({hash:z.string().length(64),reference:z.string().trim().max(255).default(''),requestKey:key.optional()}).parse(req.body);ok(res,await f.releaseFunding(req.user,q,q.hash,q.reference,q.requestKey));}));
financeRouter.post('/withdrawals',asyncHandler(async(req,res)=>{const q=scope.extend({requestKey:key,amount:z.string(),receiverName:z.string().trim().max(128).optional(),bankName:z.string().trim().max(128).optional(),bankAccount:z.string().trim().max(128).optional(),payMethod:z.enum(['alipay','wechat','bank']).optional(),payAccount:z.string().trim().max(128).optional()}).parse(req.body);ok(res,await f.applyWithdrawal(req.user,q,q.requestKey,q),201);}));
financeRouter.post('/withdrawals/:id/review',asyncHandler(async(req,res)=>{const q=scope.extend({action:z.enum(['approve','reject','cancel']),reason:z.string().trim().max(500).default('')}).parse(req.body);ok(res,await f.reviewWithdrawal(req.user,q,id.parse(req.params.id),q.action,q.reason));}));
financeRouter.post('/withdrawals/:id/pay',(req,res,next)=>upload(req,res,e=>next(e?new AppError(422,42200,'付款凭证最大 5 MB，请检查文件和表单'):undefined)),asyncHandler(async(req,res)=>{
 const q=scope.extend({reference:z.string().trim().max(128).optional(),paidOn:z.string().date(),acknowledged:z.union([z.literal(true),z.literal('true')]),requestKey:key.optional(),payMethod:z.enum(['alipay','wechat','bank']).optional(),payAccount:z.string().trim().max(128).optional(),remark:z.string().trim().max(500).optional()}).parse(req.body);
 ok(res,await f.recordPayment(req.user,q,id.parse(req.params.id),q,req.file));
}));
financeRouter.get('/withdrawals/:id/proof',asyncHandler(async(req,res)=>{const q=scope.parse(req.query),p=await f.paymentProof(req.user,q,id.parse(req.params.id));res.setHeader('X-Content-Type-Options','nosniff');res.type(p.type).attachment(p.name).send(p.buffer);}));


financeRouter.get('/payment-sheet',asyncHandler(async(req,res)=>{const q=scope.parse(req.query);ok(res,await f.paymentSheet(req.user,q));}));

financeRouter.post('/withdrawals/:id/correct',asyncHandler(async(req,res)=>{
 const q=scope.extend({requestKey:key,expectedVersion:z.coerce.number().int().min(0),action:z.enum(['amend','void']),reason:z.string().trim().min(1).max(500),paidOn:z.string().date().optional(),reference:z.string().trim().max(128).optional(),remark:z.string().trim().max(500).optional(),payMethod:z.enum(['alipay','wechat','bank']).optional(),payAccount:z.string().trim().max(128).optional()}).parse(req.body);
 ok(res,await f.correctPayment(req.user,q,id.parse(req.params.id),q));
}));
financeRouter.get('/withdrawals/:id/history',asyncHandler(async(req,res)=>ok(res,await f.paymentHistory(req.user,scope.parse(req.query),id.parse(req.params.id)))));
