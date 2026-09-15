import {Router} from 'express';
import {z} from 'zod';
import bcrypt from 'bcryptjs';
import {randomBytes} from 'node:crypto';
import {requireDuty} from './duties';
import {rows,withTransaction} from '../db';
import {asyncHandler,AppError} from '../middleware/errors';
import {ok} from '../utils/response';
import {writeAudit} from '../services/audit.service';
import {revocationStore} from '../auth/revocation';
import {revokeUserSessions} from '../auth/tokenSessions';
export const staffRouter=Router();
staffRouter.use(requireDuty('staff'));
staffRouter.get('/',asyncHandler(async(_req,res)=>ok(res,await rows("SELECT CAST(id AS CHAR) id,username,display_name,admin_duty,is_active FROM users WHERE role='admin' ORDER BY id"))));
staffRouter.post('/',asyncHandler(async(req,res)=>{
 const input=z.object({username:z.string().trim().min(2).max(64),displayName:z.string().trim().min(1).max(64),duty:z.enum(['operations','finance'])}).parse(req.body);
 const password=randomBytes(9).toString('base64url'),hash=await bcrypt.hash(password,12);
 const id=await withTransaction(async c=>{
  const [existing]=await c.query<import('mysql2/promise').RowDataPacket[]>('SELECT id FROM users WHERE username=?',[input.username]);if(existing.length)throw new AppError(409,40900,'账号已存在');
  const [r]=await c.query<import('mysql2/promise').ResultSetHeader>("INSERT INTO users(username,password_hash,role,role_id,display_name,admin_duty,must_change_pwd,created_by) VALUES(?,?,'admin',(SELECT id FROM roles WHERE role_key='admin'),?,?,1,?)",[input.username,hash,input.displayName,input.duty,req.user.sub]);
  await writeAudit({userId:req.user.sub,action:'staff.create',resourceType:'user',resourceId:String(r.insertId),detail:{duty:input.duty}},c);return String(r.insertId);
 });ok(res,{id,username:input.username,temporaryPassword:password},201);
}));
staffRouter.patch('/:id',asyncHandler(async(req,res)=>{
 const id=z.string().regex(/^\d+$/).parse(req.params.id),input=z.object({duty:z.enum(['all','operations','finance'])}).parse(req.body);
 await withTransaction(async c=>{
  const [admins]=await c.query<import('mysql2/promise').RowDataPacket[]>("SELECT id,admin_duty,is_active FROM users WHERE role='admin' ORDER BY id FOR UPDATE");
  const target=admins.find(a=>String(a.id)===id);if(!target)throw new AppError(404,40400,'管理员不存在');
  if(target.admin_duty==='all'&&input.duty!=='all'&&target.is_active&&admins.filter(a=>a.admin_duty==='all'&&a.is_active).length<=1)throw new AppError(409,40900,'至少需要保留一位完整管理员');
  await c.query('UPDATE users SET admin_duty=? WHERE id=?',[input.duty,id]);
  await writeAudit({userId:req.user.sub,action:'staff.duty',resourceType:'user',resourceId:id,detail:{from:target.admin_duty,to:input.duty}},c);
 });await revocationStore.revokeUser(id);await revokeUserSessions(id,'duty_changed');ok(res,null);
}));

