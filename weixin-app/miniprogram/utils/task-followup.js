const request=require('./request');
const actions=require('./actions');
const nav=require('./nav');
const keys=['history-submit','history-accept','history-return','history-resolve','resolve-owner'];
const methods={
 async followup(e){
  const item=this.data.list.find(x=>String(x.id)===String(e.currentTarget.dataset.id));if(!item)return;
  await this.action(async({scope})=>{
   const task=await request.get('/core/tasks/zhihu/'+scope.accountId+'/'+encodeURIComponent(item.id),{projectId:scope.projectId});
   if(this.canAct())this.setData({followupRecord:{...task,recordId:item.id,planId:item.planId,actions:task.actions.filter(a=>keys.includes(a.key)&&!a.path)},followupAction:null});
  },'');
 },
 followupChoose(e){
  if(!this.canAct()||this.data.busy)return;
  const a=this.data.followupRecord?.actions.find(x=>x.key===e.currentTarget.dataset.key);if(!a)return;
  this.setData({followupAction:{...a,fields:(a.fields||[]).map(f=>({...f,value:f.value||'',index:(f.options||[]).findIndex(o=>o.value===f.value)}))}});
 },
 followupInput(e){
  if(!this.canAct()||this.data.busy||!this.data.followupAction)return;
  const fields=this.data.followupAction.fields.map(f=>{
   if(f.key!==e.currentTarget.dataset.key)return f;
   if(f.type==='select'){const index=Number(e.detail.value);return {...f,index,value:f.options[index]?.value||''};}
   return {...f,value:e.detail.value};
  });
  this.setData({'followupAction.fields':fields});
 },
 async followupSave(){
  const record=this.data.followupRecord,a=this.data.followupAction;
  if(!record||!a||!keys.includes(a.key))return;
  const ok=await this.action(async({scope})=>{
   const input={};for(const f of a.fields){const value=String(f.value||'').trim();if(f.required&&!value)throw new Error('请填写'+f.label);if(value&&f.type==='url'&&!actions.publicUrl(value))throw new Error('请填写有效的作品链接');input[f.key]=value;}
   await actions.post(this,'/core/tasks/zhihu/'+scope.accountId+'/'+encodeURIComponent(record.id)+'/actions/'+a.key,{projectId:scope.projectId,input});
  },'已保存，相关业绩会自动更新');
  if(ok){this.setData({followupRecord:null,followupAction:null});await this.load();}
 },
 followupWorks(){const r=this.data.followupRecord;if(this.canAct()&&r)nav.go('/pages/works/index?planId='+encodeURIComponent(r.planId)+'&keyword='+encodeURIComponent(r.title));},
};
module.exports={methods,data:{followupRecord:null,followupAction:null}};
