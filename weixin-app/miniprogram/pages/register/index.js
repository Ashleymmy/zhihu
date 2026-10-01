const auth = require("../../utils/auth");
const feedback = require("../../utils/feedback");
Page({
  data: {
    phone: "",
    password: "",
    inviteCode: "",
    displayName: "",
    agreed: false,
    busy: false,
    error: "",
  },
  // 分享链接携带邀请码（pages/invite 的转发）：自动预填
  onLoad(options) {
    if (options && options.code)
      this.setData({ inviteCode: String(options.code).toUpperCase() });
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.name]: e.detail.value });
  },
  backHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },
  openAgreement(e) {
    wx.navigateTo({
      url: "/pages/agreement/index?type=" + e.currentTarget.dataset.type,
    });
  },
  toLogin() {
    wx.redirectTo({ url: "/pages/login/index" });
  },
  async submit() {
    if (this.data.busy) return;
    const phone = this.data.phone.trim();
    const password = this.data.password;
    const inviteCode = this.data.inviteCode.trim().toUpperCase();
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ error: "请输入正确的 11 位手机号" });
      return;
    }
    if (password.length < 8) {
      this.setData({ error: "密码至少 8 位" });
      return;
    }
    if (!inviteCode) {
      this.setData({ error: "请填写邀请码，请向邀请人获取" });
      return;
    }
    // 协议必须主动勾选；未勾选弹窗确认，点「同意」自动勾选并继续
    if (!this.data.agreed) {
      const ok = await feedback.confirm(this, {
        title: "用户协议及隐私协议",
        message:
          "请你务必审慎阅读、充分理解用户协议和隐私协议各条款，包含但不限于用户注意事项、用户行为规范以及为提供服务而收集、使用、存储你个人信息的情况等。如你同意，请点击下方按钮开始接受我们的服务。",
        confirmText: "同意",
        cancelText: "不同意",
      });
      if (!ok) return;
      this.setData({ agreed: true });
    }
    this.setData({ busy: true, error: "" });
    try {
      const user = await auth.register(
        phone,
        password,
        inviteCode,
        this.data.displayName.trim(),
      );
      if (user) wx.reLaunch({ url: auth.entryPath(user) });
    } catch (error) {
      this.setData({ error: error.message || "注册失败，请重试" });
    } finally {
      this.setData({ busy: false });
    }
  },
});
