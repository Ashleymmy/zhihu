const auth = require("../../utils/auth");
const consent = require("../../utils/consent");
const countdown = require("../../utils/sms-countdown");
const invitation = require("../../utils/invitation");
Page({
  data: {
    phone: "",
    password: "",
    smsCode: "",
    inviteCode: "",
    displayName: "",
    agreed: false,
    consentOpen: false,
    busy: false,
    sendingCode: false,
    cooldown: 0,
    codeNotice: "",
    error: "",
    policyReady: false,
    policyLoading: false,
    smsRequired: true,
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
      if (policy.smsRequired !== true || policy.smsEnabled !== true)
        throw new Error("短信注册暂不可用，请稍后重试");
      this.setData({ policyReady: true });
    } catch (e) {
      if (!this._disposed && revision === this._policyRevision)
        this.setData({ error: e.message || "注册规则读取失败，请重试" });
    } finally {
      if (!this._disposed && revision === this._policyRevision)
        this.setData({ policyLoading: false });
    }
  },
  onShow() {
    countdown.start(this);
  },
  onHide() {
    countdown.stop(this);
  },
  onUnload() {
    this._disposed = true;
    countdown.stop(this);
  },
  input(e) {
    const name = e.currentTarget.dataset.name;
    if (
      !["phone", "password", "smsCode", "displayName"].includes(name) ||
      this.data.busy ||
      this.data.sendingCode
    )
      return;
    if (name === "phone") this.setData({ smsCode: "", codeNotice: "" });
    this.setData({ [name]: e.detail.value });
  },
  valid() {
    if (!consent.ensure(this)) return false;
    if (!this.data.policyReady) {
      this.setData({ error: "注册规则尚未加载，请重试" });
      return false;
    }
    if (!/^1\d{10}$/.test(this.data.phone.trim())) {
      this.setData({ error: "请输入正确的 11 位手机号" });
      return false;
    }
    return true;
  },
  async sendCode() {
    if (
      this.data.busy ||
      this.data.sendingCode ||
      this.data.cooldown ||
      !this.valid()
    )
      return;
    this.setData({ sendingCode: true, error: "", smsCode: "", codeNotice: "" });
    try {
      const result = await auth.sendRegistrationCode(
        this.data.phone.trim(),
        this.data.inviteCode,
      );
      if (this._disposed) return;
      countdown.sent(this, result);
      this.setData({ codeNotice: "验证码已发送，5 分钟内有效。" });
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "发送失败，请重试" });
    } finally {
      if (!this._disposed) this.setData({ sendingCode: false });
    }
  },
  async submit() {
    if (this.data.busy || this.data.sendingCode || !this.valid()) return;
    if (this.data.password.length < 8)
      return this.setData({ error: "密码至少 8 位" });
    if (!/^\d{6}$/.test(this.data.smsCode.trim()))
      return this.setData({ error: "请输入 6 位短信验证码" });
    this.setData({ busy: true, error: "" });
    try {
      const user = await auth.register(
        this.data.phone.trim(),
        this.data.password,
        this.data.inviteCode,
        this.data.displayName.trim(),
        this.data.smsCode.trim(),
      );
      if (!this._disposed) {
        this.setData({ password: "", smsCode: "" });
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
