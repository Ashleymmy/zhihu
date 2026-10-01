const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const feedback = require("../../utils/feedback");

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
function fmt(value) {
  return Number(value || 0).toFixed(2);
}

Page(
  screen("income", {
    data: {
      from: monthRange(0).from,
      to: monthRange(0).to,
      quick: "this",
      restricted: false,
      summary: null,
      records: [],
    },
    async fetch({ scope }) {
      const period = { from: this.data.from, to: this.data.to };
      // workbench 仅对达人/团长/财务口径开放（后端 d.finance 门禁）；
      // 运营管理员打开收益页时不报错，降级为「无收益口径」引导态。
      const reportResult=await request.get('/modules/zhihu/workbench',{...scope,...period}).catch(error=>{
        if(error&&error.status===403)return null;throw error;
      });
      if (!reportResult) return { restricted: true, summary: null, records: [] };
      const report = reportResult;
      const records = report.entries
        .filter((entry) => entry.ownReceivable)
        .map((entry) => ({
          key: entry.id,
          keyword: entry.keyword || "推广结算",
          date: entry.date,
          amount: fmt(entry.amount),
          status: entry.status,
          statusText: entry.status === "confirmed" ? "已确认" : "待确认",
          blocked: entry.blocked || "",
        }));
      const summary = report.summary;
      return {
        restricted: false,
        summary: Object.assign({}, summary, {
          receivable: fmt(summary.receivable),
          confirmedReceivable: fmt(summary.confirmedReceivable),
          pendingReceivable: fmt(summary.pendingReceivable),
        }),
        records,
      };
    },
    quickRange(e) {
      if (this.data.busy || this.data.loading) return;
      const key = e.currentTarget.dataset.q;
      const range = monthRange(key === "prev" ? -1 : 0);
      this.setData({ from: range.from, to: range.to, quick: key });
      return this.load();
    },
    dateChange(e) {
      if (this.data.busy || this.data.loading) return;
      const name = e.currentTarget.dataset.name;
      const next = { from: this.data.from, to: this.data.to, quick: "" };
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
