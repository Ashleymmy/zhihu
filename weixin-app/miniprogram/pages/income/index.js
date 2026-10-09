const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const feedback = require("../../utils/feedback");
const permissions = require("../../utils/permissions");
const amount = require("../../utils/amount");
const nav = require("../../utils/nav");
const { dateText } = require("../../utils/work-display");

// 与 actions.today() 同口径（UTC+8）的月份区间；当月右端不超过今天
function monthRange(offset) {
  const shifted = new Date(Date.now() + 8 * 3600000);
  const month0 = shifted.getUTCMonth() + offset;
  const first = new Date(Date.UTC(shifted.getUTCFullYear(), month0, 1));
  const last = new Date(Date.UTC(shifted.getUTCFullYear(), month0 + 1, 0));
  const fmt = (d) => d.toISOString().slice(0, 10);
  const range = { from: fmt(first), to: fmt(last) };
  const today = actions.today();
  if (range.to > today) range.to = today;
  return range;
}

// 后端金额是 4 位小数字符串，展示统一两位
const fmt = amount.money;

Page(
  screen("income", {
    pageSize: 20,
    data: {
      from: monthRange(0).from,
      to: monthRange(0).to,
      quick: "this",
      restricted: false,
      summary: null,
      records: [],
      groups: [],
      metricType: '',
      group: '',
      selected: null,
      history: [],
      historyPage: 1,
      historyTotal: 0,
      historyError: '',
      historyLoading: false,
    },
    async fetch({ scope, user }) {
      if (!permissions.canFinance(user)) return {restricted:true,summary:null,records:[],groups:[],selected:null};
      const period = { from: this.data.from, to: this.data.to };
      if (period.from > period.to) throw Error('开始日期不能晚于结束日期');
      const reportResult=await request.get('/core/earnings/mine',{...scope,...period,page:this.data.page,pageSize:20,
        ...(this.data.metricType?{metricType:this.data.metricType}:{}),
        ...(user.role==='leader' && this.data.group?{group:this.data.group}:{})}).catch(error=>{
        if(error&&error.status===403)return null;throw error;
      });
      if (!reportResult) return { restricted: true, summary: null, records: [], groups:[], selected:null };
      const report = reportResult;
      const records = report.list.map(entry => {
        const internal=Number(entry.isInternal)===1, ready=Number(entry.isReady)===1;
        const status=internal?'internal':!ready?'checking':entry.confirmedAt?(amount.units(entry.pendingAmount)!==BigInt(0)?'adjustment':'confirmed'):'pending';
        return {...entry,key:entry.id,keyword:entry.taskName,date:entry.businessDate,
          amountText:amount.label(entry.amount),priceText:amount.price(entry.unitPrice),
          calculationText:amount.label(entry.calculationAmount),confirmedText:amount.label(entry.confirmedAmount),
          pendingText:amount.label(entry.pendingAmount),status,
          statusText:internal?'内部业绩':status==='checking'?'平台核对中':status==='confirmed'?'已确认':status==='adjustment'?'差额待确认':'待确认',
          blocked:!ready?entry.reason:'',nextText:entry.nextAction};
      });
      const summary = report.summary;
      return {
        restricted: false,
        summary: Object.assign({}, summary, {
          receivable: fmt(summary.amount),
          confirmedReceivable: fmt(summary.confirmedAmount),
          pendingReceivable: fmt(summary.pendingAmount),
          internalText:fmt(summary.internalAmount),
        }),
        records,total:report.total,
        groups:report.groups.map(g=>({...g,key:g.projectId+':'+g.metricType,amountText:amount.label(permissions.isAdmin(user)?g.internalAmount:g.amount)})),
        selected:null,history:[],historyLoading:false,historyError:'',
      };
    },
    filter(e) {
      const {field,value}=e.currentTarget.dataset;
      if(!['metricType','group'].includes(field)||this.data.busy||this.data.loading)return;
      if(field==='metricType'&&!['','new_user','activation'].includes(value))return;
      if(field==='group'&&!['','self','team'].includes(value))return;
      this.setData({[field]:value,page:1,selected:null});return this.load();
    },
    async detail(e) {
      if(!this.canAct()||this.data.loading)return;
      const selected=this.data.records.find(r=>r.id===String(e.currentTarget.dataset.id));
      if(!selected)return;
      this.setData({selected,history:[],historyPage:1,historyTotal:0,historyLoading:false});
      return this.loadHistory();
    },
    async loadHistory() {
      if(!this.canAct()||!this.data.selected||this.data.historyLoading)return;
      const id=this.data.selected.id,version=this._loadVersion,generation=this._historyGeneration=(this._historyGeneration||0)+1;
      this.setData({historyLoading:true,historyError:''});
      try {
        const result=await request.get('/core/earnings/'+id+'/history',{page:this.data.historyPage});
        if(this.canAct()&&version===this._loadVersion&&generation===this._historyGeneration&&this.data.selected?.id===id)
          this.setData({history:result.list.map((r,i)=>({...r,key:i,confirmedAt:dateText(r.confirmedAt),amountText:amount.label(r.amount)})),historyTotal:result.total});
      } catch(error) {
        if(this.canAct()&&version===this._loadVersion&&generation===this._historyGeneration&&this.data.selected?.id===id)this.setData({historyError:error.message});
      } finally {
        if(version===this._loadVersion&&generation===this._historyGeneration&&this.data.selected?.id===id)this.setData({historyLoading:false});
      }
    },
    historyPage(e) {
      if(this.data.historyLoading)return;
      const page=this.data.historyPage+Number(e.currentTarget.dataset.step);
      if(page<1||page>Math.ceil(this.data.historyTotal/25))return;
      this.setData({historyPage:page});return this.loadHistory();
    },
    closeDetail(){this._historyGeneration=(this._historyGeneration||0)+1;this.setData({selected:null,history:[],historyLoading:false});},
    keyword(){
      if(!this.canAct()||!this.data.selected)return;
      const row=this.data.selected;
      this.closeDetail();
      nav.go('/pages/keywords/index?search='+encodeURIComponent(row.taskName));
    },
    quickRange(e) {
      if (this.data.busy || this.data.loading) return;
      const key = e.currentTarget.dataset.q;
      const range = monthRange(key === "prev" ? -1 : 0);
      this.setData({ from: range.from, to: range.to, quick: key, page:1,selected:null });
      return this.load();
    },
    dateChange(e) {
      if (this.data.busy || this.data.loading) return;
      const name = e.currentTarget.dataset.name;
      const next = { from: this.data.from, to: this.data.to, quick: "",page:1,selected:null };
      next[name] = e.detail.value;
      if (next.from > next.to) {
        feedback.toast("开始日期不能晚于结束日期");
        return;
      }
      this.setData(next);
      return this.load();
    },
  }),
);
