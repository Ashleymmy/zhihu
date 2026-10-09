const auth = require("./auth");
const permissions = require("./permissions");
const scopes = require("./scope");
const actions = require("./actions");
const nav = require("./nav");
const feedback = require("./feedback");
function define(page, config) {
  const scoped = config.scoped !== false;
  const custom = Object.assign({}, config);
  delete custom.fetch;
  delete custom.scoped;
  return Object.assign(custom, {
    data: Object.assign(
      {
        user: null,
        allowed: false,
        denied: false,
        guest: false,
        loading: false,
        busy: false,
        error: "",
        notice: "",
        scopeReady: false,
        scopeLabel: "",
        page: 1,
        total: 0,
        loadingMore: false,
      },
      config.data,
    ),
    onShow() {
      this._hidden = false;
      if (config.show) config.show.call(this);
      if (this.data.busy) {
        this._reloadOnIdle = true;
        return;
      }
      return this.load();
    },
    onHide() {
      this._loadVersion = (this._loadVersion || 0) + 1;
      this._hidden = true;
      if (config.hide) config.hide.call(this);
    },
    onUnload() {
      this._loadVersion = (this._loadVersion || 0) + 1;
      this._hidden = true;
      this._context = null;
    },
    home() {
      wx.switchTab({ url: "/pages/home/index" });
    },
    // 下拉刷新：无限滚动页重置回第 1 页；加载完收起刷新动画。
    async onPullDownRefresh() {
      const stop = () => {
        try {
          wx.stopPullDownRefresh();
        } catch (_) {
          /* 基础库不支持时忽略 */
        }
      };
      if (this.data.busy) {
        stop();
        return;
      }
      if (config.infinite && this.data.page !== 1) this.setData({ page: 1 });
      try {
        await this.load();
      } finally {
        stop();
      }
    },
    onReachBottom() {
      // 返回 Promise 便于测试与调用方等待合并完成
      if (config.infinite) return this.more();
    },
    // 触底加载下一页：默认按 config.listKeys（默认 ['list']）合并并按 id 去重；
    // 列表嵌套在其它字段（如 view.withdrawals）或需派生数据时由 config.merge 接管。
    async more() {
      if (!config.infinite) return;
      if (this.data.busy || this.data.loading || this.data.loadingMore) return;
      if (!this.canAct()) return;
      const size = config.pageSize || 20;
      if ((this.data.page || 1) * size >= (this.data.total || 0)) return;
      const version = this._loadVersion;
      this.setData({ loadingMore: true, page: (this.data.page || 1) + 1 });
      try {
        const result = (await config.fetch.call(this, this._context)) || {};
        if (version !== this._loadVersion || !this.canAct()) return;
        if (config.merge) {
          config.merge.call(this, result);
        } else {
          const patch = {};
          const rest = Object.assign({}, result);
          for (const key of config.listKeys || ["list"]) {
            const current =
              key
                .split(".")
                .reduce((o, k) => (o == null ? o : o[k]), this.data) || [];
            const next = result[key] || [];
            delete rest[key];
            const seen = new Set(current.map((i) => i && i.id));
            patch[key] = current.concat(
              next.filter((i) => !i || i.id == null || !seen.has(i.id)),
            );
          }
          if (rest.total === undefined) rest.total = this.data.total;
          this.setData(Object.assign(patch, rest));
        }
      } catch (error) {
        if (version !== this._loadVersion) return;
        // 触底加载失败不打断浏览：退回页码，上拉可重试
        this.setData({ page: Math.max(1, (this.data.page || 1) - 1) });
        feedback.toast("加载失败，上拉重试");
      } finally {
        if (version === this._loadVersion) this.setData({ loadingMore: false });
      }
    },
    async load() {
      if (this.data.busy) return;
      this._hidden = false;
      // 无限滚动页整体重载时必须回到第 1 页，否则只拉当前页会丢掉已累积的列表
      if (config.infinite && this.data.page !== 1) this.setData({ page: 1 });
      const version = (this._loadVersion = (this._loadVersion || 0) + 1);
      this._context = null;
      this.setData({ loading: true, error: "" });
      try {
        const user = await auth.ensure();
        if (version !== this._loadVersion) return;
        if (!user) {
          // 游客模式：不强制跳转登录页，页面以游客态渲染；
          // 点击具体功能时由 open()/toLogin() 引导登录。
          this._context = null;
          this.setData({
            user: null,
            allowed: false,
            denied: false,
            guest: true,
            scopeReady: false,
            loading: false,
          });
          return;
        }
        if (user.mustChangePwd && page !== "password") {
          this.setData({ allowed: false });
          wx.reLaunch({ url: "/pages/password/index" });
          return;
        }
        const allowed = permissions.allowed(user, page);
        this.setData({isStaff:permissions.isAdmin(user),canManageProjects:["admin","developer"].includes(user.role)&&permissions.canOperate(user)});
        this.setData({
          user,
          allowed,
          denied: !allowed,
          guest: false,
          roleLabel: permissions.roleLabel(user),
        });
        if (!allowed) {
          this._context = null;
          return;
        }
        const view = scoped ? await scopes.ensure() : null;
        if (version !== this._loadVersion || getApp().globalData.user !== user)
          return;
        const scope = view ? Object.assign({}, view.scope) : {};
        this._context = {
          user,
          scope,
          token: wx.getStorageSync(auth.TOKEN_KEY),
        };
        const contextKey = JSON.stringify([
          user.id,
          this._context.token,
          scope,
        ]);
        if (this._contextKey && this._contextKey !== contextKey) {
          actions.finish(this);
          this.setData(
            Object.assign(JSON.parse(JSON.stringify(config.data || {})), {
              page: 1,
              selected: null,
              notice: "",
              formOpen: false,
              applyOpen: false,
            }),
          );
        }
        this._contextKey = contextKey;
        this.setData({
          scopeReady: !scoped || !!scope.accountId,
          scopeLabel: view ? view.label : "",
          scopeNotice: view ? view.notice : "",
        });
        if (scoped && !scope.accountId) return;
        const result = await config.fetch.call(this, this._context);
        if (version === this._loadVersion && this.canAct())
          this.setData(result || {});
      } catch (error) {
        if (version === this._loadVersion) {
          this._context = null;
          this.setData({ error: error.message || "加载失败，请重试" });
        }
      } finally {
        if (version === this._loadVersion) this.setData({ loading: false });
      }
    },
    async refresh() {
      if (this.data.busy || this.data.loading || !this.canAct()) return;
      const version = this._loadVersion;
      try {
        const result = await config.fetch.call(this, this._context);
        if (version === this._loadVersion && this.canAct())
          this.setData(result || {});
      } catch (error) {
        // 静默刷新：失败不打断用户，不展示 loading/error，等下一轮或手动刷新
      }
    },
    canAct() {
      const ctx = this._context;
      return (
        !!ctx &&
        !this._hidden &&
        this.data.allowed &&
        permissions.allowed(getApp().globalData.user, page) &&
        ctx.user === getApp().globalData.user &&
        ctx.token === wx.getStorageSync(auth.TOKEN_KEY) &&
        (!scoped ||
          (!!ctx.scope.accountId &&
            JSON.stringify(ctx.scope) ===
              JSON.stringify(getApp().globalData.scope)))
      );
    },
    async action(work, success = "操作已完成") {
      if (this.data.busy || this.data.loading || !this.canAct()) return false;
      const ctx = this._context;
      this._activeIntents = [];
      this.setData({ busy: true, error: "", notice: "" });
      try {
        await work(ctx);
        actions.finish(this, this._activeIntents);
        const active = this.canAct();
        if (active) {
          this.setData({ notice: success });
          // 成功即时轻提示 + 触觉反馈（iOS 习惯）；页面 notice 条仍保留供回看
          if (success) feedback.success(success);
        }
        return active;
      } catch (error) {
        if (!this._hidden)
          this.setData({ error: error.message || "操作失败，请重试" });
        return false;
      } finally {
        this._activeIntents = null;
        this.setData({ busy: false });
        if (this._reloadOnIdle && !this._hidden) {
          this._reloadOnIdle = false;
          this.load();
        }
      }
    },
    input(e) {
      this.setData({ [e.currentTarget.dataset.name]: e.detail.value });
    },
    prev() {
      if (!this.data.busy && !this.data.loading && this.data.page > 1) {
        this.setData({ page: this.data.page - 1 });
        return this.load();
      }
    },
    next() {
      if (
        !this.data.busy &&
        !this.data.loading &&
        this.data.page * (config.pageSize || 20) < this.data.total
      ) {
        this.setData({ page: this.data.page + 1 });
        return this.load();
      }
    },
    copy(e) {
      if (this.canAct() && e.currentTarget.dataset.text)
        wx.setClipboardData({ data: String(e.currentTarget.dataset.text) });
    },
    open(e) {
      if (this.data.guest || !this._context) {
        wx.navigateTo({ url: "/pages/login/index" });
        return;
      }
      if (this.canAct()) nav.go(e.currentTarget.dataset.path);
    },
    toLogin() {
      wx.navigateTo({ url: "/pages/login/index" });
    },
  });
}
module.exports = define;
