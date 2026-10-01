const auth = require("../../utils/auth");
Page({
  data: { username: "", password: "", busy: false, error: "" },
  async onLoad() {
    try {
      const user = await auth.ensure();
      if (user) wx.reLaunch({ url: auth.entryPath(user) });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
  input(e) {
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
  // 没有短信/邮件通道，重置只能由管理员侧发起：团长在团队页重置达人，
  // 平台账号由运营/全量管理员重置。重置后拿到临时密码，登录后强制设置新密码。
  forgotPassword() {
    wx.showModal({
      title: "忘记密码",
      content:
        "请联系你的团长或运营管理员重置密码（团队页 → 成员「管理」→「重置密码」）。重置后会得到一次性临时密码，登录时需设置新密码。",
      confirmText: "知道了",
      showCancel: false,
    });
  },
  async submit() {
    if (this.data.busy) return;
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
    if (this.data.busy) return;
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
