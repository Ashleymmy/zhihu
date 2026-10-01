const screen = require("../../utils/screen");
const request = require("../../utils/request");
const scopes = require("../../utils/scope");
const actions = require("../../utils/actions");
Page(
  screen("admin", {
    scoped: false,
    data: {
      channels: [],
      mappings: [],
      channelIndex: 0,
      formOpen: false,
      form: { name: "", from: actions.today(), to: "" },
      mappingScope: null,
      syncChannelIndex: 0,
      syncOffset: 0,
      hasMoreTasks: false,
      upstream: { keywordId: "", zhihuPlanId: "", reason: "", acknowledged: false },
      diagnostics: null,
      showDiagnostics: false,
      autoRetry: { enabled: false, roles: [], maxAttempts: 5 },
      // WXML 表达式不支持 indexOf，角色选中态用派生布尔值渲染
      autoRetryCreator: false,
      autoRetryLeader: false,
    },
    syncAutoRetryRoles(roles) {
      this.setData({
        "autoRetry.roles": roles,
        autoRetryCreator: roles.indexOf("creator") >= 0,
        autoRetryLeader: roles.indexOf("leader") >= 0,
      });
    },
    async fetch() {
      const view = await scopes.ensure();
      const scope = view && view.scope;
      const [options, autoRetry] = await Promise.all([
        scope && scope.accountId
          ? request.get("/modules/zhihu/attribution-options", scope)
          : Promise.resolve({ channels: [], mappings: [] }),
        Promise.resolve(null),
      ]);
      return {
        channels: options.channels,
        mappings: options.mappings,
        mappingScope: scope || null,
        scopeLabel: view ? view.label : "",
        scopeNotice: view ? view.notice : "",
        autoRetry: autoRetry || { enabled: false, roles: [], maxAttempts: 5 },
        autoRetryCreator: !!(autoRetry && (autoRetry.roles || []).indexOf("creator") >= 0),
        autoRetryLeader: !!(autoRetry && (autoRetry.roles || []).indexOf("leader") >= 0),
      };
    },
    toggleAutoRetry(e) {
      this.setData({ "autoRetry.enabled": e.detail.value });
    },
    toggleAutoRetryRole(e) {
      const role = e.currentTarget.dataset.role;
      const roles = this.data.autoRetry.roles.slice();
      const at = roles.indexOf(role);
      if (at >= 0) roles.splice(at, 1);
      else roles.push(role);
      this.syncAutoRetryRoles(roles);
    },
    async saveAutoRetry() {
      if (
        await this.action(async () => {
          const cfg = this.data.autoRetry;
          await actions.post(this, "/core/settings/keyword-auto-retry", {
            enabled: cfg.enabled,
            roles: cfg.roles,
            maxAttempts: cfg.maxAttempts,
          });
        }, "放通配置已保存")
      )
        await this.load();
    },
    toggleForm() {
      if (this.canAct() && !this.data.busy)
        this.setData({ formOpen: !this.data.formOpen, error: "" });
    },
    chooseChannel(e) {
      this.setData({ channelIndex: Number(e.detail.value) });
    },
    chooseSyncChannel(e) {
      this.setData({ syncChannelIndex: Number(e.detail.value) });
    },
    checkedUpstream(e) { this.setData({"upstream.acknowledged":e.detail.value.includes("yes")}); },
    currentScope() {
      const scope=this.data.mappingScope;
      if (!scope || !scope.accountId || JSON.stringify(scope)!==JSON.stringify(getApp().globalData.scope)) throw new Error("请返回工作台重新选择项目");
      return scope;
    },
    async syncChannels() {
      if (await this.action(async()=>{
        await actions.post(this,"/modules/zhihu/channels/sync",this.currentScope());
      },"渠道同步任务已提交")) await this.load();
    },
    async syncTasks() {
      if (await this.action(async()=>{
        const channel=this.data.channels[this.data.syncChannelIndex];
        if (!channel) throw new Error("请先同步渠道并选择");
        const channelId=channel.zhihuChannelId;
        const same=channelId===this._syncChannel;
        const result=await actions.post(this,"/modules/zhihu/tasks/sync",Object.assign({},this.currentScope(),{channelId,offset:same?this.data.syncOffset:0}));
        if (this.canAct()) {this._syncChannel=channelId;this.setData({syncOffset:result.hasMore?result.nextOffset:0,hasMoreTasks:result.hasMore});}
      },"任务同步请求已提交")) await this.load();
    },
    async confirmUpstream() {
      if (await this.action(async()=>{
        const form=this.data.upstream;
        const keywordId=String(form.keywordId||"").trim();
        // 与 syncTasks 一致：ID 输入框误带的空白先裁掉，否则 /^\d+$/ 会因一个空格报「请完整填写」。
        if (!/^\d+$/.test(keywordId) || !form.zhihuPlanId.trim() || !form.reason.trim() || !form.acknowledged) throw new Error("请完整填写并核对上游计划信息");
        await actions.post(this,"/modules/zhihu/keywords/"+keywordId+"/confirm-upstream",Object.assign({},this.currentScope(),{zhihuPlanId:form.zhihuPlanId.trim(),reason:form.reason.trim(),acknowledged:true}));
      },"上游计划已核对")) {this.setData({upstream:{keywordId:"",zhihuPlanId:"",reason:"",acknowledged:false}});await this.load();}
    },
    toggleDiagnostics() {
      if (!this.data.busy) this.setData({ showDiagnostics: !this.data.showDiagnostics });
    },
    async loadDiagnostics() {
      if (await this.action(async()=>{
        const diagnostics=await request.get("/modules/zhihu/keywords/diagnostics",this.currentScope());
        this.setData({diagnostics});
      },"诊断完成")) return true;
    },
    async fixPlanStatus() {
      if (await this.action(async()=>{
        const result=await actions.post(this,"/modules/zhihu/keywords/fix-plan-status",this.currentScope());
        this.setData({notice:"已修复 "+result.fixed+" 个关键词的计划状态"});
        await this.loadDiagnostics();
      },"计划状态已修复")) await this.load();
    },
    async createMapping() {
      if (
        await this.action(async () => {
          const channel = this.data.channels[this.data.channelIndex],
            form = this.data.form,
            scope = this.data.mappingScope;
          if (
            !scope ||
            !scope.accountId ||
            JSON.stringify(scope) !== JSON.stringify(getApp().globalData.scope)
          )
            throw new Error("请返回工作台重新选择项目");
          if (
            !channel ||
            !form.name.trim() ||
            !form.from ||
            (form.to && form.to <= form.from)
          )
            throw new Error("请选择渠道，填写映射名称和有效日期区间");
          await actions.post(
            this,
            "/modules/zhihu/channel-mappings",
            Object.assign({}, scope, {
              channelId: String(channel.id),
              name: form.name.trim(),
              from: form.from,
              to: form.to || undefined,
            }),
          );
        }, "渠道映射已创建")
      ) {
        this.setData({ formOpen: false });
        await this.load();
      }
    },
  }),
);
