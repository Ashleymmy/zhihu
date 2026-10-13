const permissions = require("../../utils/permissions");
const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const feedback = require("../../utils/feedback");
const amount = require("../../utils/amount");
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
      policy: null,
      quote: null,
      rulesOpen: false,
      rulesAccepted: false,
      attention: 'all',
      invoiceItem: null,
      invoiceInstructions: "",
      invoiceReason: "",
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
      const policy = await request.get('/core/finance/withdrawal-policy');
      if (this.canAct()) this.setData({policy});
      const view = await request.get(
        "/core/finance",
        Object.assign({}, scope, { moduleId: "zhihu", page: this.data.page, attention:this.data.attention }),
      );
      const labels = {
        pending: "待审核",
        approved: "已批准，待付款",
        paid: "已打款",
        rejected: "已退回",
        cancelled: "已撤回",
      };
      view.withdrawals = view.withdrawals.map((item) =>
        Object.assign({}, item, {
          statusText: labels[item.status] || item.status,
          amount: amount.money(item.amount),
          feeAmount: amount.money(item.feeAmount || '0'),
          netAmount: amount.money(item.netAmount == null ? item.amount : item.netAmount),
          invoiceStatusText: ({pending:'待财务核验',accepted:'已核验',rejected:'请补充发票'})[item.invoiceStatus] || '待提供发票',
          canPay: item.status === 'approved' && (!item.invoiceRequired || item.invoiceStatus === 'accepted'),
        }),
      );
      if(view.balance){const cents=amount.units(view.balance.available,2);view.balance.availableDisplay=String(cents/BigInt(100))+'.'+String(cents%BigInt(100)).padStart(2,'0');view.canWithdraw=cents>=BigInt((view.withdrawalPolicy||policy).enabled?1000:1);}
      return { view, policy:view.withdrawalPolicy || policy, total: view.total };
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
        this.setData({ applyOpen: true, form: empty(), quote:null,rulesAccepted:false,error: "" });
    },
    close() {
      if (!this.data.busy)
        this.setData({ applyOpen: false, selected: null, payment: null, invoiceItem:null,proofFileId: "", error: "" });
    },
    // 「全部提现」快捷填入当前可提现余额
    fillAll() {
      const available = this.data.view && this.data.view.balance
        ? this.data.view.balance.available
        : "";
      if (available) {const cents=amount.units(available,2);this.setData({ "form.amount":String(cents/BigInt(100))+'.'+String(cents%BigInt(100)).padStart(2,'0'),quote:null,rulesAccepted:false });}
    },
    amountInput(e) { if(this.data.busy)return; this.setData({'form.amount':e.detail.value,quote:null,rulesAccepted:false}); },
    toggleRules(){this.setData({rulesOpen:!this.data.rulesOpen});},
    async filterAttention(e){if(this.data.busy||this.data.loading)return;this.setData({attention:e.currentTarget.dataset.value,page:1});await this.load();},
    acceptRules(e){this.setData({rulesAccepted:e.detail.value.includes('yes')});},
    async previewAmount(){
      await this.action(async({scope})=>{
        const value=this.data.form.amount.trim();
        if(!actions.money(value))throw new Error('请输入金额，最多两位小数');
        const quote=await request.get('/core/finance/withdrawal-quote',{...scope,moduleId:'zhihu',amount:value});
        if(this.canAct())this.setData({quote:{...quote,amount:amount.money(quote.amount),feeAmount:amount.money(quote.feeAmount),netAmount:amount.money(quote.netAmount)},rulesAccepted:false});
      },'');
    },
    async apply() {
      if(this.data.policy&&this.data.policy.enabled&&!this.data.quote){await this.previewAmount();return;}
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
          if (amount.units(form.amount) > amount.units(this.data.view.balance.available))
            throw new Error("申请金额超过可提现余额");
          if (!form.receiverName || !form.bankName || !form.bankAccount)
            throw new Error("请完整填写收款资料");
          if(this.data.policy&&this.data.policy.enabled){
            if(!this.data.rulesAccepted)throw new Error('请核对费用、到账金额和提现规则');
            if(!this.data.quote||amount.units(form.amount)!==amount.units(this.data.quote.amount))throw new Error('金额已修改，请重新核对');
            form.policyVersion=this.data.quote.policyVersion;form.quoteToken=this.data.quote.quoteToken;
          }
          try { await actions.post(
            this,
            "/core/finance/withdrawals",
            Object.assign({}, scope, { moduleId: "zhihu" }, form),
          ); } catch(error) {
            if(Number(error.code)===40910){
              if(this.canAct())this.setData({quote:null,rulesAccepted:false});
              const policy=await request.get('/core/finance/withdrawal-policy');
              if(this.canAct())this.setData({policy});
              throw new Error('提现规则或日期已更新，请重新核对到账金额并确认');
            }
            throw error;
          }
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
              ? "撤回后释放未付款的占用金额。按新规则受理的申请仍计入今日次数，明天可再次申请。"
              : "退回后释放未付款的占用金额。按新规则受理的申请仍计入今日次数。",
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
    invoice(e){
      if(!this.canAct()||this.data.busy)return;
      const item=this.data.view.withdrawals[e.currentTarget.dataset.index];
      if(!item||!item.invoiceRequired)return;
      this.setData({invoiceItem:item,invoiceInstructions:item.invoiceInstructions||'',invoiceReason:'',error:''});
    },
    async saveInvoiceInstructions(){
      const item=this.data.invoiceItem;if(!item)return;
      if(await this.action(async({scope})=>{await actions.post(this,'/core/finance/withdrawals/'+item.id+'/invoice-instructions',{...scope,moduleId:'zhihu',instructions:this.data.invoiceInstructions});},'开票要求已保存')){this.setData({invoiceItem:null});await this.load();}
    },
    async submitInvoice(){
      const item=this.data.invoiceItem;if(!item)return;
      if(await this.action(async({scope})=>{
        const fileId=await upload(scope,'withdrawal-invoice',()=>this.canAct(),{withdrawalId:item.id});
        await actions.post(this,'/core/finance/withdrawals/'+item.id+'/invoice',{...scope,moduleId:'zhihu',expectedVersion:item.invoiceVersion,fileId});
      },'发票已提交，等待财务核验')){this.setData({invoiceItem:null});await this.load();}
    },
    async decideInvoice(e){
      const item=this.data.invoiceItem;if(!item)return;
      if(await this.action(async({scope})=>{await actions.post(this,'/core/finance/withdrawals/'+item.id+'/invoice-review',{...scope,moduleId:'zhihu',expectedVersion:item.invoiceVersion,action:e.currentTarget.dataset.action,reason:this.data.invoiceReason});},'发票核验结果已保存')){this.setData({invoiceItem:null});await this.load();}
    },
    async openInvoice(){
      const item=this.data.invoiceItem;if(!item)return;
      await this.action(async({scope})=>{const file=await request.get('/core/finance/withdrawals/'+item.id+'/invoice',{...scope,moduleId:'zhihu'});if(!this.canAct())return;await this.openFile(file,'invoice-'+item.id);},'');
    },
    async openFile(file,name){
      const ext=file.mimeType==='application/pdf'?'pdf':file.mimeType==='image/png'?'png':'jpg';
      const filePath=wx.env.USER_DATA_PATH+'/'+name+'.'+ext;
      await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath,data:file.base64,encoding:'base64',success:resolve,fail:reject}));
      if(!this.canAct())return;
      if(ext==='pdf')await wx.openDocument({filePath,fileType:ext});else await wx.previewImage({urls:[filePath]});
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
        await actions.post(this, "/core/finance/withdrawals/" + payment.id + "/pay", Object.assign({}, scope, form, {moduleId:"zhihu",reference: form.reference.trim(), fileId: this.data.proofFileId},payment.policyVersion?{policyVersion:payment.policyVersion,netAmount:payment.netAmount}:{}));
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
