const auth = require("../../utils/auth");
const consent = require("../../utils/consent");
const countdown = require("../../utils/sms-countdown");
const invitation = require("../../utils/invitation");
Page({
  data: {
    phone: "",
    smsCode: "",
    sendingCode: false,
    cooldown: 0,
    codeNotice: "",
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
      if (policy.registrationMode !== "sms" || policy.smsRequired !== true)
        throw new Error("注册服务尚未更新，请稍后重试");
      if (!policy.smsEnabled) throw new Error("短信注册暂不可用，请稍后重试；已有账号可直接登录");
      this.setData({ policyReady: true });
    } catch (e) {
      if (!this._disposed && revision === this._policyRevision)
        this.setData({ error: e.message || "注册规则读取失败，请重试" });
    } finally {
      if (!this._disposed && revision === this._policyRevision)
        this.setData({ policyLoading: false });
    }
  },
  onShow() { countdown.start(this); },
  onHide() { countdown.stop(this); },
  onUnload() { this._disposed = true; countdown.stop(this); },
  input(e) {
    const name = e.currentTarget.dataset.name;
    if (
      !["phone", "smsCode", "displayName"].includes(name) ||
      this.data.busy || this.data.sendingCode
    )
      return;
    if (name === "phone") this.setData({ smsCode: "", codeNotice: "" });
    this.setData({ [name]: e.detail.value });
  },
  validPhone() {
    if (!consent.ensure(this)) return false;
    if (!this.data.policyReady) { this.setData({ error: "短信注册尚未就绪，请重试" }); return false; }
    if (!/^1\d{10}$/.test(this.data.phone.trim())) { this.setData({ error: "请输入正确的 11 位手机号" }); return false; }
    return true;
  },
  async sendCode() {
    if (this.data.busy || this.data.sendingCode || this.data.cooldown || !this.validPhone()) return;
    const phone = this.data.phone.trim();
    this.setData({ sendingCode: true, error: "", smsCode: "", codeNotice: "" });
    try {
      const result = await auth.sendRegistrationCode(phone, this.data.inviteCode);
      if (this._disposed) return;
      countdown.sent(this, result);
      if (phone === this.data.phone.trim()) this.setData({ codeNotice: "验证码已发送，5 分钟内有效。" });
    } catch (e) {
      if (!this._disposed) this.setData({ error: e.message || "发送失败，请重试" });
    } finally { if (!this._disposed) this.setData({ sendingCode: false }); }
  },
  async submit() {
    if (this.data.busy || this.data.sendingCode || !this.validPhone()) return;
    if (!/^\d{6}$/.test(this.data.smsCode.trim())) return this.setData({ error: "请输入 6 位短信验证码" });
    this.setData({ busy: true, error: "" });
    try {
      const user = await auth.register(
        this.data.phone.trim(),
        this.data.smsCode.trim(),
        this.data.inviteCode,
        this.data.displayName.trim(),
      );
      if (!this._disposed) {
        countdown.stop(this);
        this.setData({ smsCode: "" });
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
