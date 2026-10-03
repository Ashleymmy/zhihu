const auth = require("../../utils/auth");
const consent = require("../../utils/consent");
const invitation = require("../../utils/invitation");
Page({
  data: {
    username: "",
    password: "",
    inviteCode: "",
    displayName: "",
    agreed: false,
    consentOpen: false,
    busy: false,
    error: "",
    policyReady: false,
    policyLoading: false,
  },
  ...consent.methods,
  onLoad(options = {}) {
    this.setData({ inviteCode: invitation.capture(options) });
    return this.loadPolicy();
  },
  async loadPolicy() {
    const revision = (this._policyRevision = (this._policyRevision || 0) + 1);
    this.setData({ policyReady: false, policyLoading: true, error: "" });
    try {
      const policy = await auth.registrationPolicy(this.data.inviteCode);
      if (this._disposed || revision !== this._policyRevision) return;
      if (policy.registrationMode !== "account" || policy.smsRequired !== false)
        throw new Error("注册服务尚未更新，请稍后重试");
      this.setData({ policyReady: true });
    } catch (e) {
      if (!this._disposed && revision === this._policyRevision)
        this.setData({ error: e.message || "注册规则读取失败，请重试" });
    } finally {
      if (!this._disposed && revision === this._policyRevision)
        this.setData({ policyLoading: false });
    }
  },
  onUnload() {
    this._disposed = true;
  },
  input(e) {
    const name = e.currentTarget.dataset.name;
    if (
      !["username", "password", "displayName"].includes(name) ||
      this.data.busy
    )
      return;
    this.setData({ [name]: e.detail.value });
  },
  async submit() {
    if (this.data.busy || !consent.ensure(this)) return;
    if (!this.data.policyReady)
      return this.setData({ error: "注册规则尚未加载，请重试" });
    const username = this.data.username.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(username))
      return this.setData({
        error: "账号为 3–32 位，以字母开头，可使用字母、数字、下划线或短横线",
      });
    if (this.data.password.length < 8)
      return this.setData({ error: "密码至少 8 位" });
    this.setData({ busy: true, error: "" });
    try {
      const user = await auth.register(
        username,
        this.data.password,
        this.data.inviteCode,
        this.data.displayName.trim(),
      );
      if (!this._disposed) {
        this.setData({ password: "" });
        if (user) wx.reLaunch({ url: auth.entryPath(user) });
      }
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "注册失败，请重试" });
    } finally {
      if (!this._disposed) this.setData({ busy: false });
    }
  },
  toLogin() {
    wx.redirectTo({ url: invitation.route("/pages/login/index") });
  },
  backHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
