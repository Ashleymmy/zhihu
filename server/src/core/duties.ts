import type { RequestHandler } from 'express';
import type { AuthUser } from '../types';
import { AppError } from '../middleware/errors';
export type AdminDuty='all'|'operations'|'finance';
export function dutyAllows(user:AuthUser,area:'operations'|'finance'|'staff'){
 return user.role==='admin'&&((user.adminDuty??'all')==='all'||area!=='staff'&&user.adminDuty===area);
}
export function assertDuty(user:AuthUser,area:'operations'|'finance'|'staff'){
 if(!dutyAllows(user,area))throw new AppError(403,40301,area==='finance'?'此操作需要财务权限':area==='staff'?'只有完整管理员可以管理岗位权限':'此操作需要运营权限');
}
export const requireDuty=(area:'operations'|'finance'|'staff'):RequestHandler=>(req,_res,next)=>{try{assertDuty(req.user,area);next();}catch(e){next(e)}};

