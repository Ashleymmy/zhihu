import type { RequestHandler } from 'express';
import type { AuthUser } from '../types';
import { AppError } from '../middleware/errors';
import { effectiveDuty, isStaffRole } from '../auth/roles';
export type AdminDuty='all'|'operations'|'finance';
export function dutyAllows(user:AuthUser,area:'operations'|'finance'|'staff'){
 return isStaffRole(user.role)&&(effectiveDuty(user)==='all'||area!=='staff'&&effectiveDuty(user)===area);
}
export function assertDuty(user:AuthUser,area:'operations'|'finance'|'staff'){
 if(!dutyAllows(user,area))throw new AppError(403,40301,area==='finance'?'这里需要财务权限':area==='staff'?'只有完整管理员可以管理岗位权限':'此操作需要运营权限');
}
export const requireDuty=(area:'operations'|'finance'|'staff'):RequestHandler=>(req,_res,next)=>{try{assertDuty(req.user,area);next();}catch(e){next(e)}};

