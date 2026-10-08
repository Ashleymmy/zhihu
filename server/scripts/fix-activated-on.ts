import type { AuthUser } from '../src/types';
import { effectiveDuty, isStaffRole } from '../src/auth/roles';

export async function main(args=process.argv.slice(2)) {
  const value=(name:string)=>args[args.indexOf(name)+1];
  for(const name of ['--project','--account','--actor'])if(!args.includes(name)||!/^\d+$/.test(value(name)??''))throw Error('用法：npx tsx scripts/fix-activated-on.ts --project 项目ID --account 账号ID --actor 人员ID [--prices-only] [--apply]；默认仅预览');
  const {db}=await import('../src/db');
  try{
    const [rows]=await db.query<import('mysql2/promise').RowDataPacket[]>('SELECT id,username,display_name,role,admin_duty,parent_id FROM users WHERE id=? AND is_active=1',[value('--actor')]);
    const actor=rows[0];if(!actor||!isStaffRole(String(actor.role)))throw Error('请选择有效的管理人员');
    const user:AuthUser={sub:String(actor.id),username:String(actor.username),displayName:String(actor.display_name),role:actor.role,adminDuty:actor.admin_duty,parentId:actor.parent_id===null?null:String(actor.parent_id),jti:'start-date-repair'};
    const pricesOnly=args.includes('--prices-only');
    if(!pricesOnly&&effectiveDuty(user)==='finance')throw Error('此操作需要运营权限');
    const repair=pricesOnly?(await import('../src/modules/zhihu/attribution/price-repair')).repairMissingPrices:(await import('../src/modules/zhihu/attribution/activation-date')).repairActivatedOn;
    const result=await repair(user,{projectId:value('--project'),accountId:value('--account')},args.includes('--apply'));
    console.log(JSON.stringify(result,null,2));
  }finally{await db.end();}
}
if(require.main===module)void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
