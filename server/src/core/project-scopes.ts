import type {AuthUser} from '../types';
import {listProjects} from '../services/projectMembers.service';
import {projectAccounts} from './accounts';
import type {ModuleRuntime} from './module-runtime';

// Disabled modules are intentional absences; failed modules remain visible so
// users can retry instead of mistaking incomplete data for completed work.
export async function serviceProjects(runtime:ModuleRuntime,user:AuthUser){
 const projects=(await listProjects(user)).filter(project=>project.isEnabled);
 const scoped=await Promise.all(projects.map(async project=>({...project,accounts:(await projectAccounts(user,project.id)).filter(account=>{
  const module=runtime.get(account.moduleId),manifest=module?.manifest??runtime.catalog.find(item=>item.id===account.moduleId);
  return account.status==='active'&&!!manifest?.roles.includes(user.role)&&(!!module||runtime.failures.has(account.moduleId));
 })})));
 return scoped.filter(project=>project.accounts.length>0);
}
