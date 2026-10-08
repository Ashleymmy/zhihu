import type {PoolConnection,RowDataPacket} from 'mysql2/promise';

export interface AnalysisScope {projectId:string;accountId:string;moduleId:string;runKey:string}
export interface AnalysisOption {key:string;label:string;tone?:'primary'|'neutral';disabled?:boolean}
export interface AnalysisAsk {id:string;text:string;options:AnalysisOption[]}
export interface AnalysisStep {key:string;title:string;summary:string;status:'pending'|'running'|'done'|'ask'|'failed'|'skipped';asks?:AnalysisAsk[]}
export interface AnalysisRun {
  id:string;fileName:string;source?:string;createdAt?:string;
  status:'running'|'needs_input'|'done'|'failed';progress:{done:number;total:number};steps:AnalysisStep[];
  conclusion?:{title:string;value:string;summary:string;pendingText?:string;actions?:AnalysisOption[]};
}
// Providers authorize the actor and execute the choice in the same transaction.
// The platform only stores generic choices; it does not interpret module data.
export async function analysisAnswers(c:PoolConnection,s:AnalysisScope){
  const [rows]=await c.query<RowDataPacket[]>('SELECT ask_key,option_key FROM opc_analysis_answers WHERE project_id=? AND account_id=? AND module_id=? AND run_key=?',[s.projectId,s.accountId,s.moduleId,s.runKey]);
  return new Map(rows.map(r=>[String(r.ask_key),String(r.option_key)]));
}
export async function saveAnalysisAnswer(c:PoolConnection,s:AnalysisScope,askId:string,option:string,actorId:string){
  await c.query(`INSERT INTO opc_analysis_answers(project_id,account_id,module_id,run_key,ask_key,option_key,answered_by)
    VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE option_key=VALUES(option_key),answered_by=VALUES(answered_by),answered_at=NOW(3)`,[s.projectId,s.accountId,s.moduleId,s.runKey,askId,option,actorId]);
}
