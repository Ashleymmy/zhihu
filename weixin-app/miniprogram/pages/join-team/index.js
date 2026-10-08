const screen = require('../../utils/screen');
const request = require('../../utils/request');
const scopes = require('../../utils/scope');
const feedback = require('../../utils/feedback');
const labels = {pending:'等待团长确认', approved:'已加入', rejected:'未通过', cancelled:'已撤回'};
Page(screen('join-team', {
  scoped: false,
  data: { affiliation:null, leaders:[], filteredLeaders:[], applications:[], pending:null, query:'', selected:null, message:'' },
  async fetch() {
    const [affiliation, leaders, applications] = await Promise.all([
      request.get('/core/team/affiliation'), request.get('/core/team/leaders'), request.get('/core/team/applications/mine'),
    ]);
    const query = this.data.query.trim().toLowerCase();
    const selected = leaders.find(l => l.id === this.data.selected?.id) || null;
    // Returning after a leader approves an application must refresh project availability too.
    if (affiliation.team && !this.data.affiliation?.team) scopes.reset();
    return {affiliation, leaders, selected,
      filteredLeaders:leaders.filter(l => `${l.displayName} ${l.username}`.toLowerCase().includes(query)),
      applications:applications.map(a=>({...a,statusText:labels[a.status]||a.status})),
      pending:applications.find(a=>a.status==='pending')||null};
  },
  searchLeader(e) {
    const query = e.detail.value;
    this.setData({query,selected:null,filteredLeaders:this.data.leaders.filter(l => `${l.displayName} ${l.username}`.toLowerCase().includes(query.trim().toLowerCase()))});
  },
  pickLeader(e) {
    if(this.data.busy) return;
    const selected = this.data.leaders.find(l=>String(l.id)===String(e.currentTarget.dataset.id));
    if(selected) this.setData({selected});
  },
  async apply() {
    if(this.data.affiliation?.team || this.data.pending || !this.data.selected) return;
    if(await this.action(async()=>{
      await request.post('/core/team/applications',{leaderUsername:this.data.selected.username,...(this.data.message.trim()?{message:this.data.message.trim()}:{})});
    },'申请已提交，等待团长确认')) {
      this.setData({selected:null,message:''});
      await this.load();
    }
  },
  async cancel() {
    const item=this.data.pending;
    if(!item || this.data.busy) return;
    if(!await feedback.confirm(this,{title:'撤回申请',message:'撤回后可以重新选择团长。',confirmText:'撤回'})) return;
    if(await this.action(()=>request.post('/core/team/applications/'+item.id+'/cancel',{}),'申请已撤回')) await this.load();
  },
}));
