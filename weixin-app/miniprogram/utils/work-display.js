function reviewDisplay(item) {
  let status=item.zhihuStatusJson;
  if(typeof status==='string'){try{status=JSON.parse(status)}catch(_){status=null}}
  const data=status&&typeof status==='object'?status:{};
  const code=data.auditStatus??data.audit_status??data.status;
  const labels={pending:'待审核',reviewing:'审核中',approved:'已通过',passed:'已通过',rejected:'已拒绝'};
  return {
    statusText:item.syncStatus==='failed'?'提交失败':item.syncStatus==='synced'?'已提交知乎':'正在提交',
    upstreamText:item.planSyncStatus==='failed'?'关键词创建失败，作品未进入知乎审核':item.syncStatus==='failed'?'作品提交失败，请修改后重新提交':['local','syncing'].includes(item.syncStatus)?'正在提交知乎':item.compositionId?(code==null||code===''?'已提交知乎，等待审核结果':'知乎审核：'+(labels[code]||String(code))):'尚未登记知乎推广作品',
    syncText:{local:'待提交知乎',syncing:'知乎提交中',synced:'已提交知乎',failed:'知乎提交失败',simulated:'联测作品'}[item.syncStatus]||'',
    upstreamReason:item.failureReason||data.rejectReason||data.reject_reason||''
  };
}
const composition=require('./composition');
function dateText(value){if(!value)return '未填写';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');}
function detail(item){const type=composition.types.find(t=>t.value===Number(item.compositionType));const i=composition.types.indexOf(type);const sub=i<0?null:composition.categories(i).find(t=>t.value===Number(item.compositionSubType));return {...item,...reviewDisplay(item),typeText:type?.label||'未填写',subTypeText:sub?.label||'未填写',createdText:dateText(item.createdAt),releaseText:dateText(item.releaseTime)};}
function decode(value){try{return decodeURIComponent(value||'')}catch(_){return value||''}}
module.exports={reviewDisplay,detail,dateText,decode};
