const permissions = require("../../utils/permissions");
const screen = require("../../utils/screen");
const request = require("../../utils/request");
const composition = require("../../utils/composition");
const {reviewDisplay,decode}=require('../../utils/work-display');
const nav=require('../../utils/nav');
Page(
  screen("works", {
    infinite: true,
    onLoad(query={}){this.setData({from:query.from||'',to:query.to||'',view:query.view||'all',ownerId:query.ownerId||'',ownerName:decode(query.ownerName),result:query.result||'',registeredOnly:query.registeredOnly||'',editId:query.edit||''});},
    data: {from:'',to:'',view:'all',ownerId:'',ownerName:'',result:'',registeredOnly:'',editId:'',list:[],selected:null,form:{},platforms:composition.mediaTypes,types:composition.types.map(t=>t.label),categories:[]},
    async fetch({ user, scope }) {
      const result = await request.get(
        "/modules/zhihu/workbench/works",
        Object.assign({}, scope, this.filters(), { page: this.data.page, pageSize: 20 }),
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
    filters(){const out={};for(const key of ['from','to','view','ownerId','result','registeredOnly'])if(this.data[key])out[key]=this.data[key];return out;},
    showDetail(e){if(this.canAct())nav.go('/pages/work-detail/index?id='+encodeURIComponent(e.currentTarget.dataset.id));},
    clearFilters(){this.setData({from:'',to:'',view:'all',ownerId:'',ownerName:'',result:'',registeredOnly:'',list:[]});return this.load();},
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
