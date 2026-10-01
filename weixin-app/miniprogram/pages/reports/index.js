const screen = require('../../utils/screen')
const request = require('../../utils/request')
const actions = require('../../utils/actions')
const {upload} = require('../../utils/upload')
const base = '/modules/zhihu/'
const labels = {pending:'等待处理',done:'处理完成',preparing:'正在解析',preview:'待确认导入',queued:'等待处理',processing:'处理中',completed:'处理完成',failed:'处理失败'}
Page(screen('reports', {
  data: {section:'imports',list:[],detail:null,detailPage:1,selected:null,reason:'',accept:true,acknowledged:false},
  async fetch({scope}) {
    const result = await request.get(base + this.data.section, Object.assign({}, scope, {page:this.data.page,pageSize:20}))
    return {list:result.list.map(row=>Object.assign({}, row, {statusText:labels[row.status] || row.status})),total:result.total}
  },
  section(e) {
    if (this.data.busy || this.data.loading || !this.canAct()) return
    const section=e.currentTarget.dataset.section
    if (!['imports','exceptions'].includes(section)) return
    this.setData({section,page:1,list:[],detail:null,selected:null})
    return this.load()
  },
  async uploadReport() {
    let imported
    if (await this.action(async ({scope})=>{
      const fileId=await upload(scope,'report',()=>this.canAct())
      imported=await actions.post(this,base+'imports',Object.assign({},scope,{fileId,reportKind:"combined"}))
    },'文件已解析，请查看预览并核对')) {
      this.setData({section:'imports',page:1})
      await this.load()
      if (this.canAct()) await this.showDetail(imported.id,1)
    }
  },
  async showDetail(id,page) {
    await this.action(async ({scope})=>{
      const detail=await request.get(base+'imports/'+id,Object.assign({},scope,{page,pageSize:20}))
      detail.rowCount=(detail.counts||[]).reduce((n,c)=>n+Number(c.total),0)
      detail.rows=(detail.rows||[]).map(row=>({...row,value:typeof row.normalizedJson==='string'?JSON.parse(row.normalizedJson):row.normalizedJson,error:row.errorText}))
      if (this.canAct()) this.setData({detail,detailPage:page,acknowledged:false})
    },'')
  },
  inspect(e) {const row=this.data.list[e.currentTarget.dataset.index];if(row)return this.showDetail(row.id,1)},
  detailPrev() {if(this.data.detailPage>1)return this.showDetail(this.data.detail.id,this.data.detailPage-1)},
  detailNext() {if(this.data.detailPage*20<this.data.detail.rowCount)return this.showDetail(this.data.detail.id,this.data.detailPage+1)},
  acknowledge(e) {this.setData({acknowledged:e.detail.value.includes('yes')})},
  async commit() {
    const detail=this.data.detail
    if (!detail) return
    if (await this.action(async ({scope})=>{
      if (!this.data.acknowledged) throw new Error('请先核对报表内容并勾选确认')
      await actions.post(this,base+'imports/'+detail.id+'/commit',Object.assign({},scope,{previewHash:detail.previewHash}))
    },'已提交后台处理，请稍后刷新查看进度')) {this.setData({detail:null});await this.load()}
  },
  choose(e) {
    if (!this.canAct() || this.data.busy) return
    const selected=this.data.list[e.currentTarget.dataset.index]
    if (selected) this.setData({selected,reason:'',accept:e.currentTarget.dataset.accept!==false})
  },
  async resolve() {
    const selected=this.data.selected
    if (!selected) return
    if (await this.action(async ({scope})=>{
      const reason=this.data.reason.trim()
      if (!reason) throw new Error('请填写核对依据或修复说明')
      const revision=this.data.section==='metric-revisions'
      const path=base+(revision?'metric-revisions/':'exceptions/')+selected.id+(revision?'/resolve':'/retry')
      await actions.post(this,path,Object.assign({},scope,{reason},revision?{accept:this.data.accept}:{}))
    },'已处理')) {this.setData({selected:null});await this.load()}
  },
  close() {if(!this.data.busy)this.setData({detail:null,selected:null})},
}))
