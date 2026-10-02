const consent = require("../../utils/consent");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const countdown = require("../../utils/sms-countdown");
Page({
  ...consent.methods,
  data: {
    phone: "",
    password: "",
    smsCode: "",
    registeredPhone: false,
    loading: true,
    enabled: false,
    busy: false,
    sendingCode: false,
    cooldown: 0,
    agreed: false,
    consentOpen: false,
    error: "",
    codeNotice: "",
    verified: false,
  },
  async onLoad() {
    try {
      const user = await auth.ensure();
      if (!user) {
        wx.redirectTo({ url: "/pages/login/index" });
        return;
      }
      const [profile, policy] = await Promise.all([
        request.get("/core/auth/profile"),
        auth.smsPolicy(),
      ]);
      if (!this._disposed)
        this.setData({
          phone: profile.phone || "",
          registeredPhone: !!profile.phone,
          verified: !!profile.phoneVerifiedAt,
          enabled: policy.smsLoginEnabled === true,
        });
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "读取账号信息失败，请重试" });
    } finally {
      if (!this._disposed) this.setData({ loading: false });
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
    if (name === "phone" && this.data.registeredPhone) return;
    if (name === "phone") this.setData({ smsCode: "", codeNotice: "" });
    this.setData({ [name]: e.detail.value });
  },
  valid() {
    if (!consent.ensure(this)) return false;
    if (!this.data.enabled || this.data.loading || this.data.verified)
      return false;
    if (!/^1\d{10}$/.test(this.data.phone.trim())) {
      this.setData({ error: "请输入正确的 11 位手机号" });
      return false;
    }
    if (!this.data.password) {
      this.setData({ error: "请输入当前账号密码" });
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
    const phone = this.data.phone.trim();
    this.setData({ sendingCode: true, error: "", smsCode: "", codeNotice: "" });
    try {
      const result = await auth.sendPhoneCode(phone, this.data.password);
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
  async submit() {
    if (this.data.busy || this.data.sendingCode || !this.valid()) return;
    if (!/^\d{6}$/.test(this.data.smsCode.trim()))
      return this.setData({ error: "请输入 6 位验证码" });
    this.setData({ busy: true, error: "" });
    try {
      await auth.verifyPhone(
        this.data.phone.trim(),
        this.data.password,
        this.data.smsCode.trim(),
      );
      if (!this._disposed) {
        countdown.stop(this);
        this.setData({
          verified: true,
          password: "",
          smsCode: "",
          codeNotice: "手机号已验证，可以使用验证码登录。",
        });
      }
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "验证失败，请重试" });
    } finally {
      if (!this._disposed) this.setData({ busy: false });
    }
  },
  backProfile() {
    wx.redirectTo({ url: "/pages/profile/index" });
  },
});
