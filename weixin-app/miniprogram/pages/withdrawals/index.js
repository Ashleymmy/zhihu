const permissions = require("../../utils/permissions");
const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const feedback = require("../../utils/feedback");
const { upload } = require("../../utils/upload");
const empty = () => ({
  amount: "",
  receiverName: "",
  bankName: "",
  bankAccount: "",
});
Page(
  screen("withdrawals", {
    pageSize: 25,
    infinite: true,
    data: {
      view: null,
      applyOpen: false,
      form: empty(),
      selected: null,
      reviewAction: "",
      reason: "",
      payment: null,
      proofFileId: "",
      paymentForm: { reference: "", paidOn: actions.today(), acknowledged: false },
    },
    async fetch({ scope }) {
      const view = await request.get(
        "/core/finance",
        Object.assign({}, scope, { moduleId: "zhihu", page: this.data.page }),
      );
      const labels = {
        pending: "待审核",
        approved: "已批准，待付款",
        paid: "已到账",
        rejected: "已退回",
        cancelled: "已撤回",
      };
      view.withdrawals = view.withdrawals.map((item) =>
        Object.assign({}, item, {
          statusText: labels[item.status] || item.status,
        }),
      );
      return { view, total: view.total };
    },
    // 触底加载：合并嵌套在 view.withdrawals 里的列表，余额等汇总字段不重刷
    merge(result) {
      const current = (this.data.view && this.data.view.withdrawals) || [];
      const seen = new Set(current.map((i) => i.id));
      this.setData({
        "view.withdrawals": current.concat(
          (result.view.withdrawals || []).filter((i) => !seen.has(i.id)),
        ),
        total: result.total,
      });
    },
    openApply() {
      if (
        this.canAct() &&
        !this.data.busy &&
        this.data.view &&
        !this.data.view.canManage
      )
        this.setData({ applyOpen: true, form: empty(), error: "" });
    },
    close() {
      if (!this.data.busy)
        this.setData({ applyOpen: false, selected: null, payment: null, proofFileId: "", error: "" });
    },
    // 「全部提现」快捷填入当前可提现余额
    fillAll() {
      const available = this.data.view && this.data.view.balance
        ? this.data.view.balance.available
        : "";
      if (available) this.setData({ "form.amount": String(available) });
    },
    async apply() {
      if (
        await this.action(async ({ user, scope }) => {
          if (!["leader", "creator"].includes(user.role) || !this.data.view)
            throw new Error("当前账号不可申请提现");
          const form = Object.keys(this.data.form).reduce((value, key) => {
            value[key] = this.data.form[key].trim();
            return value;
          }, {});
          if (!actions.money(form.amount))
            throw new Error("金额须大于零，最多两位小数");
          if (Number(form.amount) > Number(this.data.view.balance.available))
            throw new Error("申请金额超过可提现余额");
          if (!form.receiverName || !form.bankName || !form.bankAccount)
            throw new Error("请完整填写收款资料");
          await actions.post(
            this,
            "/core/finance/withdrawals",
            Object.assign({}, scope, { moduleId: "zhihu" }, form),
          );
        }, "提现申请已提交")
      ) {
        this.setData({ applyOpen: false, form: empty(), page: 1 });
        await this.load();
      }
    },
    choose(e) {
      if (!this.canAct() || this.data.busy) return;
      const item = this.data.view.withdrawals[e.currentTarget.dataset.index],
        action = e.currentTarget.dataset.action;
      if (
        !item ||
        item.status !== "pending" ||
        !["approve", "reject", "cancel"].includes(action)
      )
        return;
      this.setData({
        selected: item,
        reviewAction: action,
        reason: "",
        error: "",
      });
    },
    async review() {
      const item = this.data.selected;
      if (!item) return;
      const reviewAction = this.data.reviewAction;
      // 撤回/退回是不可逆的资金操作，先经 iOS 风格确认弹层二次确认
      if (reviewAction === "cancel" || reviewAction === "reject") {
        const confirmed = await feedback.confirm(this, {
          title: reviewAction === "cancel" ? "撤回提现申请" : "退回提现申请",
          message:
            reviewAction === "cancel"
              ? "撤回后本次申请关闭，如需提现请重新提交。"
              : "退回后申请人可修改收款资料后重新提交。",
          confirmText: reviewAction === "cancel" ? "确认撤回" : "确认退回",
          danger: true,
        });
        if (!confirmed) return;
      }
      if (
        await this.action(async ({ user, scope }) => {
          const action = this.data.reviewAction,
            reason = this.data.reason.trim();
          if (
            action === "cancel"
              ? String(item.userId) !== String(user.id)
              : !permissions.isAdmin(user)
          )
            throw new Error("无权处理此申请");
          if (action === "reject" && !reason) throw new Error("请填写退回原因");
          await actions.post(
            this,
            "/core/finance/withdrawals/" + item.id + "/review",
            Object.assign({}, scope, { moduleId: "zhihu", action, reason }),
          );
        }, "提现状态已更新")
      ) {
        this.setData({ selected: null });
        await this.load();
      }
    },
    pay(e) {
      if (!this.canAct() || this.data.busy || !this.data.view.canManage) return;
      const payment = this.data.view.withdrawals[e.currentTarget.dataset.index];
      if (!payment || payment.status !== "approved") return;
      this.setData({ payment, proofFileId: "", paymentForm: { reference: "", paidOn: actions.today(), acknowledged: false } });
    },
    acknowledgePayment(e) {
      this.setData({ "paymentForm.acknowledged": e.detail.value.includes("yes") });
    },
    async uploadProof() {
      await this.action(async ({ scope }) => {
        const proofFileId = await upload(scope, "payment-proof", () => this.canAct());
        if (this.canAct()) this.setData({ proofFileId });
      }, "付款凭证已上传");
    },
    async recordPayment() {
      const payment = this.data.payment;
      if (!payment) return;
      if (await this.action(async ({scope}) => {
        const form = this.data.paymentForm;
        if (!form.acknowledged || !this.data.proofFileId || form.reference.trim().length < 4)
          throw new Error("请填写流水号、上传付款凭证，并确认已实际付款");
        await actions.post(this, "/core/finance/withdrawals/" + payment.id + "/pay", Object.assign({}, scope, form, {moduleId:"zhihu",reference: form.reference.trim(), fileId: this.data.proofFileId}));
      }, "实际付款已登记")) { this.setData({payment:null, proofFileId:""}); await this.load(); }
    },
    async proof(e) {
      const payment = this.data.view.withdrawals[e.currentTarget.dataset.index];
      if (!payment || payment.status !== "paid") return;
      await this.action(async ({scope}) => {
        const proof = await request.get("/core/finance/withdrawals/" + payment.id + "/proof", {...scope,moduleId:"zhihu"});
        if (!this.canAct()) return;
        const ext = proof.mimeType === "application/pdf" ? "pdf" : proof.mimeType === "image/png" ? "png" : "jpg";
        const filePath = wx.env.USER_DATA_PATH + "/payment-proof-" + payment.id + "." + ext;
        await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath,data:proof.base64,encoding:"base64",success:resolve,fail:reject}));
        if (!this.canAct()) return;
        if (ext === "pdf") await wx.openDocument({filePath,fileType:ext});
        else await wx.previewImage({urls:[filePath]});
      }, "");
    },
  }),
);
