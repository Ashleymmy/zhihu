const auth = require("../../utils/auth");
const countdown = require("../../utils/sms-countdown");
Page({
  data: {
    username: "",
    password: "",
    busy: false,
    error: "",
    mode: "password",
    phone: "",
    smsCode: "",
    sendingCode: false,
    cooldown: 0,
    agreed: false,
    smsLoginEnabled: false,
    codeNotice: "",
  },
  async onLoad() {
    try {
      const user = await auth.ensure();
      if (user) {
        wx.reLaunch({ url: auth.entryPath(user) });
        return;
      }
    } catch (error) {
      this.setData({ error: error.message });
    }
    try {
      const policy = await auth.smsPolicy();
      if (!this._disposed)
        this.setData({ smsLoginEnabled: policy.smsLoginEnabled === true });
    } catch (_) {}
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
  setMode(e) {
    if (this.data.busy || this.data.sendingCode) return;
    const mode = e.currentTarget.dataset.mode;
    if (mode === "sms" && !this.data.smsLoginEnabled) return;
    this.setData({
      mode: mode === "sms" ? "sms" : "password",
      error: "",
      smsCode: "",
      password: "",
      codeNotice: "",
    });
  },
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },
  async sendCode() {
    if (
      !this.data.smsLoginEnabled ||
      this.data.busy ||
      this.data.sendingCode ||
      this.data.cooldown
    )
      return;
    const phone = this.data.phone.trim();
    if (!/^1\d{10}$/.test(phone))
      return this.setData({ error: "请输入正确的 11 位手机号" });
    if (!this.data.agreed)
      return this.setData({ error: "请先阅读并同意用户协议和隐私协议" });
    this.setData({ sendingCode: true, error: "", smsCode: "", codeNotice: "" });
    try {
      const result = await auth.sendLoginCode(phone);
      if (this._disposed) return;
      countdown.sent(this, result);
      if (phone === this.data.phone.trim())
        this.setData({ codeNotice: "验证码已发送，5 分钟内有效。" });
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "发送失败，请重试" });
    } finally {
      if (!this._disposed) this.setData({ sendingCode: false });
    }
  },
  input(e) {
    if (e.currentTarget.dataset.name === "phone")
      this.setData({ smsCode: "", codeNotice: "" });
    this.setData({ [e.currentTarget.dataset.name]: e.detail.value });
  },
  backHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },
  toRegister() {
    wx.navigateTo({ url: "/pages/register/index" });
  },
  openAgreement(e) {
    wx.navigateTo({
      url: "/pages/agreement/index?type=" + e.currentTarget.dataset.type,
    });
  },
  // 验证码仅用于登录，不自动重置密码或重新绑定微信。
  forgotPassword() {
    wx.showModal({
      title: "忘记密码",
      content:
        "已验证手机号且绑定当前微信的账号可尝试验证码登录。重置密码请联系团长或运营管理员（团队页 → 成员管理 → 重置密码）。",
      confirmText: "知道了",
      showCancel: false,
    });
  },
  async submit() {
    if (this.data.busy || this.data.sendingCode) return;
    if (this.data.mode === "sms") {
      if (!this.data.smsLoginEnabled) return;
      if (
        !/^1\d{10}$/.test(this.data.phone.trim()) ||
        !/^\d{6}$/.test(this.data.smsCode.trim())
      )
        return this.setData({ error: "请输入正确手机号和 6 位验证码" });
      if (!this.data.agreed)
        return this.setData({ error: "请先阅读并同意用户协议和隐私协议" });
      this.setData({ busy: true, error: "" });
      try {
        const user = await auth.loginWithSms(
          this.data.phone.trim(),
          this.data.smsCode.trim(),
        );
        if (!this._disposed) {
          this.setData({ smsCode: "" });
          if (user) wx.reLaunch({ url: auth.entryPath(user) });
        }
      } catch (e) {
        if (!this._disposed)
          this.setData({ error: e.message || "登录失败，请重试" });
      } finally {
        if (!this._disposed) this.setData({ busy: false });
      }
      return;
    }
    if (!this.data.username.trim() || !this.data.password) {
      this.setData({ error: "请输入账号和密码" });
      return;
    }
    this.setData({ busy: true, error: "" });
    try {
      const user = await auth.login(
        this.data.username.trim(),
        this.data.password,
      );
      this.setData({ password: "" });
      if (user) wx.reLaunch({ url: auth.entryPath(user) });
    } catch (error) {
      this.setData({ error: error.message || "登录失败，请重试" });
    } finally {
      this.setData({ busy: false });
    }
  },
  async wechatLogin() {
    if (this.data.busy || this.data.sendingCode) return;
    this.setData({ busy: true, error: "" });
    try {
      const result = await auth.loginWithWeChat();
      // 当前微信未绑定账号：引导到绑定页（手机号 + 邀请码）
      if (result && result.needsBind) {
        wx.navigateTo({ url: "/pages/bind/index" });
        return;
      }
      if (result) wx.reLaunch({ url: auth.entryPath(result) });
    } catch (error) {
      this.setData({ error: error.message || "登录失败，请重试" });
    } finally {
      this.setData({ busy: false });
    }
  },
});
