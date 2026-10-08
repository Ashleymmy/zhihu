import type {PoolConnection} from 'mysql2/promise';
import {isStaffRole} from '../../../auth/roles';
import type {AuthUser} from '../../../types';
import {withTransaction} from '../../../db';
import {assertDuty,dutyAllows} from '../../../core/duties';
import {analysisAnswers,saveAnalysisAnswer,type AnalysisAsk,type AnalysisRun,type AnalysisStep} from '../../../core/analysis';
import {authorize,audit,json,mutate,select,type RecordRow} from './store';
import {fail,money,moneyText,type Scope} from './domain';
import {allocations} from './workbench';
import {resolveRevision,type AttributionSnapshot,type FactSnapshot} from './facts';

const platformScope=(scope:Scope,id:string)=>({...scope,moduleId:'zhihu',runKey:'import:'+id});
const cash=(amount:bigint)=>{const n=amount<0n?-amount:amount,cents=(n+50n)/100n;return (amount<0n?'-':'')+String(cents/100n)+'.'+String(cents%100n).padStart(2,'0');};
type RevisionChoice={ask:AnalysisAsk;revisionId:string;expected:string|null};
async function revisionChoices(c:PoolConnection,scope:Scope,id:string):Promise<RevisionChoice[]>{
 const rows=await select(c,`SELECT v.id,v.parent_revision_id,v.snapshot_json,f.current_revision_id,old.snapshot_json old_json,k.keyword,
    f.metric_type,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day
    FROM zh_metric_revisions v JOIN zh_import_rows source ON source.id=v.source_row_id JOIN zh_metric_facts f ON f.id=v.fact_id
    JOIN zh_keywords k ON k.id=f.keyword_id LEFT JOIN zh_metric_revisions old ON old.id=f.current_revision_id
    WHERE source.batch_id=? AND f.account_id=? AND f.project_id=? AND v.status='pending' ORDER BY v.id`,[id,scope.accountId,scope.projectId]);
 return rows.map(row=>{
   const current=row.old_json?json<FactSnapshot>(row.old_json):null,next=json<FactSnapshot>(row.snapshot_json),activation=row.metric_type==='activation';
   const previous=(activation?current?.activations:current?.orders)??'未提供',incoming=(activation?next.activations:next.orders)??'未提供';
   const unit=activation?'个':'单',expected=row.current_revision_id===null?null:String(row.current_revision_id);
   const fields=[['search','搜索量'],['orders','订单量'],['revenue','报表收益'],['activations','拉活量'],['settlement','结算金额'],['agency','代理名称'],['riskAssessment','风险标记']] as const;
   const changes=fields.filter(([field])=>field!==(activation?'activations':'orders')&&(current?.[field]??null)!==(next[field]??null)).map(([field,label])=>`${label}：原来 ${current?.[field]??'未提供'}，本次 ${next[field]??'未提供'}`);
   return {revisionId:String(row.id),expected,ask:{id:'revision:'+row.id+':'+(expected??'0'),
     text:`${row.business_day}「${row.keyword}」原来 ${previous} ${unit}，这份报表是 ${incoming} ${unit}${changes.length?'；'+changes.join('；'):''}，采用哪个？`,
     options:[{key:'new',label:'采用这份报表',tone:'primary',disabled:String(row.parent_revision_id??'')!==String(expected??'')},{key:'old',label:'保留原来的数字'},{key:'skip',label:'暂时跳过'}]}};
 });
}
async function readAnalysis(c:PoolConnection,user:AuthUser,scope:Scope,id:string){
 const [batch]=await select(c,`SELECT b.id,b.file_name,b.report_kind,b.status,DATE_FORMAT(b.created_at,'%Y-%m-%d %H:%i') created_at,j.status job_status
   FROM zh_import_batches b LEFT JOIN zh_processing_jobs j ON j.batch_id=b.id WHERE b.id=? AND b.account_id=? AND b.project_id=?`,[id,scope.accountId,scope.projectId]);
 if(!batch)fail('这份报表不存在或不属于当前项目',404);
 const finance=dutyAllows(user,'finance'),answers=await analysisAnswers(c,platformScope(scope,id));
 const rows=await select(c,`SELECT source.id,source.processing_status,source.error_text,${finance?'source.normalized_json':"JSON_OBJECT('date',JSON_EXTRACT(source.normalized_json,'$.date'),'channel',JSON_EXTRACT(source.normalized_json,'$.channel'),'keyword',JSON_EXTRACT(source.normalized_json,'$.keyword'),'orders',JSON_EXTRACT(source.normalized_json,'$.orders'),'activations',JSON_EXTRACT(source.normalized_json,'$.activations')) normalized_json"},source.fact_id,
   f.current_result_id,${finance?'r.snapshot_json':'NULL snapshot_json'},r.reason_code,b.executor_id,b.verification_status,
   EXISTS(SELECT 1 FROM zh_metric_revisions v WHERE v.fact_id=f.id AND v.status='pending') pending_revision,
   ${finance?"src.source_version,src.blocked_reason,(SELECT CAST(COALESCE(SUM(e.amount),0) AS CHAR) FROM opc_income_entries e WHERE e.source_id=src.id) credited":"NULL source_version,NULL blocked_reason,'0' credited"}
   FROM zh_import_rows source LEFT JOIN zh_metric_facts f ON f.id=source.fact_id AND f.account_id=? AND f.project_id=?
   LEFT JOIN zh_attribution_results r ON r.id=f.current_result_id LEFT JOIN zh_keywords k ON k.id=f.keyword_id
   LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id
   ${finance?"LEFT JOIN opc_income_sources src ON src.module_id='zhihu' AND src.account_id=f.account_id AND src.project_id=f.project_id AND src.source_key=CONCAT('fact:',f.id)":""}
   WHERE source.batch_id=? ORDER BY source.line_number`,[scope.accountId,scope.projectId,id]);
 const choices=finance?await revisionChoices(c,scope,id):[];
 const [route]=await select(c,'SELECT mode FROM zh_engine_routes WHERE account_id=? AND project_id=?',[scope.accountId,scope.projectId]);
 const pending=rows.filter(r=>r.processing_status==='pending').length,invalid=rows.filter(r=>r.processing_status==='invalid').length;
 const skipped=rows.filter(r=>r.processing_status==='skipped').length,legacy=rows.filter(r=>r.processing_status==='legacy_settled').length;
 const usable=rows.filter(r=>!['invalid','skipped','legacy_settled','pending'].includes(String(r.processing_status)));
 const unique=new Map<string,RecordRow>();
 for(const row of usable){
   const raw=json<Record<string,string|null>>(row.normalized_json),key=row.fact_id?'fact:'+row.fact_id:'source:'+JSON.stringify([raw.date,raw.channel,raw.keyword]);
   const previous=unique.get(key),before=previous?json<Record<string,string|null>>(previous.normalized_json):null;
   unique.set(key,{...row,normalized_json:{...raw,orders:raw.orders??before?.orders??null,activations:raw.activations??before?.activations??null}} as RecordRow);
 }
 let billable=0n,pendingQuantity=0n,billableAmount=0n,confirmableAmount=0n,unassigned=0,work=0,price=0,conflicts=0;
 const problems=new Set<string>();
 for(const [key,row] of unique){
   const source=json<Record<string,string|null>>(row.normalized_json),snapshot=row.snapshot_json?json<AttributionSnapshot>(row.snapshot_json):null;
   const quantity=BigInt((batch.report_kind==='activation'?snapshot?.activations??source.activations:snapshot?.orders??source.orders)??'0');
   let target:ReturnType<typeof allocations>|null=null;
   if(snapshot){try{target=allocations(snapshot);}catch{price++;problems.add(key);}}
   const paid=target&&target.list.length>0,internal=!!target&&money(target.staffAmount)>0n;
   if(paid&&target){billable+=quantity;billableAmount+=money(target.total);}else if(!internal)pendingQuantity+=quantity;
   const code=String(row.reason_code??row.error_text??'');
   if(['BINDING_MISSING','PERIOD_AMBIGUOUS'].includes(code)){unassigned++;problems.add(key);}
   if(code.startsWith('PRICE_')||code==='REPORT_INCOMPLETE'){price++;problems.add(key);}
   if(row.fact_id&&row.executor_id&&row.verification_status!=='passed'){work++;problems.add(key);}
   if(Number(row.pending_revision)){conflicts++;problems.add(key);}
   if(code||!row.fact_id)problems.add(key);
   if(paid&&target&&route?.mode!=='stopped'&&!code&&!Number(row.pending_revision)&&row.verification_status==='passed'&&String(row.source_version??'')!==String(row.current_result_id))confirmableAmount+=money(target.total)-money(String(row.credited??'0'),true);
 }
 const channel=usable.filter(r=>['CHANNEL_UNMAPPED','CHANNEL_AMBIGUOUS','PROJECT_MISMATCH'].includes(String(r.error_text))).length;
 const keywords=usable.filter(r=>r.error_text==='KEYWORD_UNKNOWN').length;
 const unit=batch.report_kind==='activation'?'个':'单',type=batch.report_kind==='activation'?'拉活':'拉新';
 const stage=(key:string,title:string,problem:number,ok:string,help:string):AnalysisStep=>({key,title,status:pending?'running':problem?'ask':'done',summary:problem?help:ok});
 const steps:AnalysisStep[]=[
   stage('read','读取报表',invalid,`已读取 ${rows.length} 行${skipped?`，跳过 ${skipped} 行汇总`:''}${legacy?`，${legacy} 行已在旧系统结算`:''}`,`${rows.length} 行已保留，${invalid} 行格式需要修正，其余行继续处理`),
   stage('channel','确认渠道',channel,'报表中的渠道已对上',`${channel} 行渠道需要运营确认`),
   stage('keyword','确认关键词',keywords,'关键词已对上',`${keywords} 行关键词需要运营核对`),
   stage('executor','确定执行人',unassigned,'执行人及开始日期已核对',`${unassigned} 条记录需要运营确认执行人或开始日期`),
   stage('work','核对作品',work,'相关作品已核验',`${work} 条记录等待补登记或核验作品，金额已算出的部分会保留`),
   stage('amount','计算金额',price+conflicts,finance?`${type}可计费 ${billable} ${unit}，共 ¥${cash(billableAmount)}`:'金额由财务核对',`${price?price+' 条记录需要财务核对单价或数量':''}${price&&conflicts?'；':''}${conflicts?conflicts+' 条记录的报表数字不同，等待财务选择':''}`),
 ];
 if(choices.length){
   steps[5].asks=choices.map(({ask})=>({...ask,text:ask.text+(answers.get(ask.id)==='skip'?'（已暂时跳过，仍可在这里处理）':'')}));
   if(choices.every(({ask})=>answers.get(ask.id)==='skip')&&!price)steps[5].status='skipped';
 }
 const need=problems.size+invalid,failed=pending>0&&batch.job_status==='failed',running=pending>0||batch.status==='preview';
 if(failed){const active=steps.find(step=>step.status==='running');if(active){active.status='failed';active.summary='处理暂时中断，已经读取的记录和结果都已保留。';}}
 const run:AnalysisRun={id,fileName:String(batch.file_name),source:'知乎'+type+'报表',createdAt:String(batch.created_at),
   status:failed?'failed':running?'running':need?'needs_input':'done',progress:{done:rows.length-pending,total:rows.length},steps,
   conclusion:{title:finance?'本次报表可计费':'报表处理结果',value:finance?'¥'+cash(billableAmount):rows.length+' 行',
     summary:finance?`${billable} ${unit}可计费 · 可确认金额 ¥${cash(confirmableAmount)}`:`${rows.length} 行已保留，金额由财务核对`,
     pendingText:need?`${need} 条记录仍需处理${finance&&pendingQuantity?'，涉及 '+pendingQuantity+' '+unit:''}，其他记录可以继续核对。`:'没有待处理的数据问题。',
     actions:[{key:'details',label:finance?'查看金额与待处理明细':'查看待处理记录',tone:'primary'},...(invalid&&finance?[{key:'replace-file',label:'选择修正后的报表'}]:[]),...(failed&&finance?[{key:'retry',label:'继续处理'}]:[])]}};
 return {...run,...(finance?{totals:{billableQuantity:String(billable),billableAmount:moneyText(billableAmount),confirmableAmount:moneyText(confirmableAmount),pendingQuantity:String(pendingQuantity)}}:{})};
}
export async function importAnalysis(user:AuthUser,scope:Scope,id:string){
 if(!isStaffRole(user.role))fail('报表分析仅管理人员可见',403);
 await authorize(user,scope);return withTransaction(c=>readAnalysis(c,user,scope,id));
}
export async function answerImportAnalysis(user:AuthUser,scope:Scope,id:string,key:string,askId:string,option:string){
 assertDuty(user,'finance');
 return mutate(user,scope,'analysis.answer',key,{id,askId,option},async c=>{
   const [batch]=await select(c,'SELECT id FROM zh_import_batches WHERE id=? AND account_id=? AND project_id=? FOR UPDATE',[id,scope.accountId,scope.projectId]);
   if(!batch)fail('这份报表不存在或不属于当前项目',404);
   const choice=(await revisionChoices(c,scope,id)).find(choice=>choice.ask.id===askId);
   if(!choice||!choice.ask.options.some(candidate=>candidate.key===option&&!candidate.disabled))fail('这项数据或选项已更新，请重新查看分析结果',409);
   if(option!=='skip')await resolveRevision(c,user,scope,choice.revisionId,choice.expected,option==='new'?'报表分析中确认采用本次数字':'报表分析中确认保留原来数字',option==='new');
   await saveAnalysisAnswer(c,platformScope(scope,id),askId,option,user.sub);
   await audit(c,user,'analysis.answer',id,{askId,option});
   return readAnalysis(c,user,scope,id);
 });
}
