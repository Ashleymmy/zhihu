const screen=require('../../utils/screen');
const request=require('../../utils/request');
const display=require('../../utils/work-display');
Page(screen('work-detail',{
 data:{id:'',work:null},
 onLoad(query={}){this.setData({id:display.decode(query.id)});},
 async fetch({scope}){if(!/^(composition:)?[0-9]+$/.test(this.data.id))throw new Error('请从作品列表重新打开详情');const item=await request.get('/modules/zhihu/workbench/work-detail',{...scope,id:this.data.id});return {work:display.detail(item)};}
}));
