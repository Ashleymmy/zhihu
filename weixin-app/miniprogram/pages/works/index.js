const permissions = require("../../utils/permissions");
const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const feedback = require("../../utils/feedback");
function canReview(user, item) {
  return (
    item.source === "evidence" && item.status === "pending" &&
    (permissions.isAdmin(user) ||
      (user.role === "leader" && String(item.executorId) !== String(user.id)))
  );
}
function reviewDisplay(item) {
  let status=item.zhihuStatusJson;
  if(typeof status==='string'){try{status=JSON.parse(status)}catch(_){status=null}}
  const data=status&&typeof status==='object'?status:{};
  const code=data.auditStatus??data.audit_status??data.status;
  const labels={pending:'待审核',reviewing:'审核中',approved:'已通过',passed:'已通过',rejected:'已拒绝'};
  return {
    statusText:item.source==='evidence'?({pending:'平台待审核',passed:'平台已通过',rejected:'平台已退回'}[item.status]||item.status):'推广作品',
    upstreamText:item.compositionId?(code==null||code===''?'知乎暂未返回审核结果':'知乎审核：'+(labels[code]||String(code))):'尚未登记知乎推广作品',
    syncText:{local:'待提交知乎',syncing:'知乎提交中',synced:'已提交知乎',failed:'知乎提交失败',simulated:'联测作品'}[item.syncStatus]||'',
    upstreamReason:data.rejectReason||data.reject_reason||''
  };
}
Page(
  screen("works", {
    infinite: true,
    data: { list: [], selected: null, reason: "" },
    async fetch({ user, scope }) {
      const result = await request.get(
        "/modules/zhihu/workbench/works",
        Object.assign({}, scope, { page: this.data.page, pageSize: 20 }),
      );
      return {
        total: result.total,
        list: result.list.map((item) =>
          Object.assign({}, item, {
            canReview: canReview(user, item),
            ...reviewDisplay(item),
          }),
        ),
      };
    },
    choose(e) {
      const item = this.data.list[e.currentTarget.dataset.index];
      if (
        this.canAct() &&
        !this.data.busy &&
        item &&
        canReview(this.data.user, item)
      )
        this.setData({ selected: item, reason: "", error: "" });
    },
    close() {
      if (!this.data.busy) this.setData({ selected: null });
    },
    async review(e) {
      const item = this.data.selected;
      if (!item) return;
      const accept = e.currentTarget.dataset.accept === "true";
      // 退回是不可直接恢复的操作，先经 iOS 风格确认弹层二次确认
      if (!accept) {
        if (!this.data.reason.trim()) {
          this.setData({ error: "请填写退回原因" });
          return;
        }
        const confirmed = await feedback.confirm(this, {
          title: "退回该作品？",
          message: "退回后达人需修改作品并重新提交审核。",
          confirmText: "确认退回",
          danger: true,
        });
        if (!confirmed) return;
      }
      if (
        await this.action(
          async ({ user, scope }) => {
            if (!canReview(user, item)) throw new Error("当前作品不可审核");
            if (!accept && !this.data.reason.trim())
              throw new Error("请填写退回原因");
            await actions.post(
              this,
              "/modules/zhihu/evidence/" + item.id + "/review",
              Object.assign({}, scope, {
                accept,
                reason:
                  this.data.reason.trim() || "已核对作品链接及关键词使用情况",
              }),
            );
          },
          accept ? "作品已通过审核" : "已退回修改",
        )
      ) {
        this.setData({ selected: null });
        await this.load();
      }
    },
  }),
);
