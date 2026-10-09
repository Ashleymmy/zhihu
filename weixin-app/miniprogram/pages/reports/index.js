const screen=require('../../utils/screen');
const request=require('../../utils/request');
const web=require('../../utils/web-link');
const {dateText}=require('../../utils/work-display');
const base='/modules/zhihu/';
const labels={preparing:'正在读取',preview:'待核对',committed:'已提交处理',pending:'等待处理',queued:'等待处理',running:'处理中',processing:'处理中',processed:'已读取',completed:'处理完成',failed:'处理失败',open:'需要跟进',done:'已处理',resolved:'已处理'};
Page(screen('reports',{
  data:{section:'imports',list:[],detail:null,detailPage:1,issueView:'open'},
  async fetch({scope}){
    const result=await request.get(base+this.data.section,{...scope,page:this.data.page,pageSize:20,...(this.data.section==='exceptions'?{status:this.data.issueView}:{})});
    return {list:result.list.map(row=>{
      // 同步读取已完成时，队列可能尚未更新；不能再把已读取报表说成等待处理。
      const status=['failed','running'].includes(row.jobStatus)?row.jobStatus:row.status==='processed'?'processed':row.jobStatus||row.status;
      return {...row,createdAt:dateText(row.createdAt),statusText:labels[status]||'等待更新',typeText:row.reportKind==='activation'?'拉活':row.reportKind?'拉新':''};
    }),total:result.total,detail:null};
  },
  section(e){if(this.data.loading||this.data.busy)return;const section=e.currentTarget.dataset.section;if(!['imports','exceptions'].includes(section))return;this.setData({section,page:1,list:[],detail:null});return this.load();},
  issueView(e){this.setData({issueView:e.currentTarget.dataset.view,page:1});return this.load();},
  async inspect(e){const row=this.data.list.find(r=>String(r.id)===String(e.currentTarget.dataset.id));if(!row)return;
    return this.action(async({scope})=>{const detail=await request.get(base+'imports/'+row.id+'/analysis',scope);if(this.canAct())this.setData({detail:{...detail,id:row.id,fileName:row.fileName}});},'');
  },
  web(){web.copy(this,'reports');},
}));
