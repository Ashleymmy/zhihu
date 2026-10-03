const permissions = require("../../utils/permissions");
const screen = require("../../utils/screen");
const request = require("../../utils/request");
const composition = require("../../utils/composition");
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
Page(
  screen("works", {
    infinite: true,
    data: {list:[],selected:null,form:{},platforms:composition.mediaTypes,types:composition.types.map(t=>t.label),categories:[]},
    async fetch({ user, scope }) {
      const result = await request.get(
        "/modules/zhihu/workbench/works",
        Object.assign({}, scope, { page: this.data.page, pageSize: 20 }),
      );
      return {
        total: result.total,
        list: result.list.map((item) =>
          Object.assign({}, item, {
            canEdit: !!item.canEdit && permissions.canOperate(user),
            ...reviewDisplay(item),
          }),
        ),
      };
    },
    choose(e) {
      const item=this.data.list[e.currentTarget.dataset.index];
      if(!this.canAct()||this.data.busy||!item?.canEdit)return;
      const typeIndex=Math.max(0,composition.types.findIndex(t=>t.value===Number(item.compositionType)));
      const categories=composition.categories(typeIndex);
      this.setData({selected:item,error:'',categories:categories.map(t=>t.label),form:{
        mediaAccount:item.mediaAccount||'',url:item.workUrl||'',title:item.description==='小程序登记作品'?'':item.description||'',
        platformIndex:composition.mediaTypes.indexOf(item.mediaType),workTypeIndex:typeIndex,
        contentTypeIndex:categories.findIndex(t=>t.value===Number(item.compositionSubType)),
        publishDate:item.releaseTime?new Date(new Date(item.releaseTime).getTime()+8*3600000).toISOString().slice(0,10):'',releaseTime:item.releaseTime||''
      }});
    },
    close(){if(!this.data.busy)this.setData({selected:null,error:''});},
    editInput(e){this.setData({['form.'+e.currentTarget.dataset.field]:e.detail.value});},
    editPlatform(e){this.setData({'form.platformIndex':Number(e.detail.value)});},
    editType(e){const index=Number(e.detail.value);this.setData({'form.workTypeIndex':index,'form.contentTypeIndex':0,categories:composition.categories(index).map(t=>t.label)});},
    editCategory(e){this.setData({'form.contentTypeIndex':Number(e.detail.value)});},
    editDate(e){this.setData({'form.publishDate':e.detail.value,'form.releaseTime':''});},
    async save(){
      const item=this.data.selected;if(!item)return;
      const ok=await this.action(async()=>{
        const input=composition.input(item.planId,this.data.form);
        await request.patch('/modules/zhihu/compositions/'+item.compositionId,{...input,title:this.data.form.title.trim()||null});
      },'已保存，正在重新提交知乎');
      if(ok){this.setData({selected:null});await this.load();}
    },
  }),
);
