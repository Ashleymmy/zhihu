const auth = require("../../utils/auth");
const request = require("../../utils/request");
const consent = require("../../utils/consent");
const countdown = require("../../utils/sms-countdown");
const invitation = require("../../utils/invitation");
Page({
  data: {
    username: "",
    phone: "",
    password: "",
    smsCode: "",
    agreed: false,
    consentOpen: false,
    busy: false,
    sendingCode: false,
    cooldown: 0,
    error: "",
    codeNotice: "",
    fromProfile: false,
    registeredPhone: false,
    ready: false,
  },
  ...consent.methods,
  async onLoad(options = {}) {
    const fromProfile = options.from === "profile";
    this.setData({ fromProfile });
    try {
      if (fromProfile) {
        if (!(await auth.ensure())) {
          wx.redirectTo({ url: "/pages/login/index" });
          return;
        }
        const [profile, binding] = await Promise.all([
          request.get("/core/auth/profile"),
          auth.bindingStatus(),
        ]);
        if (binding.bound) {
          wx.redirectTo({ url: "/pages/profile/index" });
          return;
        }
        this.setData({
          username: profile.username,
          phone: profile.phone || "",
          registeredPhone: !!profile.phone,
        });
      }
      const policy = await auth.smsPolicy();
      if (!this._disposed)
        this.setData({
          ready: policy.smsLoginEnabled === true,
          error: policy.smsLoginEnabled ? "" : "短信验证暂不可用，请稍后重试",
        });
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "账号信息读取失败" });
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
      this.data.busy ||
      this.data.sendingCode ||
      (name === "username" && this.data.fromProfile) ||
      (name === "phone" && this.data.registeredPhone)
    )
      return;
    if (!["username", "phone", "password", "smsCode"].includes(name)) return;
    if (name !== "smsCode") this.setData({ smsCode: "", codeNotice: "" });
    this.setData({ [name]: e.detail.value });
  },
  valid() {
    if (!consent.ensure(this)) return false;
    let error = "";
    if (!this.data.ready) error = "短信验证暂不可用，请稍后重新进入";
    else if (!this.data.username.trim()) error = "请输入平台登录账号";
    else if (!this.data.password) error = "请输入当前账号密码";
    else if (!/^1\d{10}$/.test(this.data.phone.trim()))
      error = "请输入正确的 11 位手机号";
    if (error) this.setData({ error });
    return !error;
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
      const result = await auth.sendBindingCode(
        this.data.username.trim(),
        this.data.password,
        this.data.phone.trim(),
        this.data.fromProfile,
      );
      if (!this._disposed) {
        countdown.sent(this, result);
        this.setData({ codeNotice: "验证码已发送，5 分钟内有效。" });
      }
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "发送失败，请重试" });
    } finally {
      if (!this._disposed) this.setData({ sendingCode: false });
    }
  },
  async submit() {
    if (this.data.busy || this.data.sendingCode || !this.valid()) return;
    if (!/^\d{6}$/.test(this.data.smsCode.trim()))
      return this.setData({ error: "请输入 6 位短信验证码" });
    this.setData({ busy: true, error: "" });
    try {
      const user = await auth.bindWechat(
        this.data.username.trim(),
        this.data.password,
        this.data.phone.trim(),
        this.data.smsCode.trim(),
        this.data.fromProfile,
      );
      if (!this._disposed) {
        this.setData({ password: "", smsCode: "" });
        if (this.data.fromProfile)
          wx.redirectTo({ url: "/pages/profile/index" });
        else if (user) wx.reLaunch({ url: auth.entryPath(user) });
      }
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "绑定失败，请重试" });
    } finally {
      if (!this._disposed) this.setData({ busy: false });
    }
  },
  toRegister() {
    wx.redirectTo({ url: invitation.route("/pages/register/index") });
  },
  toLogin() {
    wx.redirectTo({ url: invitation.route("/pages/login/index") });
  },
  backHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
