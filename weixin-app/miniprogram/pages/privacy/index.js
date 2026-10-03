const auth = require("../../utils/auth");
const request = require("../../utils/request");
Page({
  data: {
    loading: false,
    busy: false,
    error: "",
    status: null,
    user: null,
    password: "",
    acknowledged: false,
    supportEmail: "cloudto@timoo.freeqiye.com",
  },
  async onShow() {
    this.setData({
      loading: true,
      error: "",
      password: "",
      acknowledged: false,
    });
    try {
      const user = await auth.ensure();
      this.setData({ user });
      if (user)
        this.setData({
          status: await request.get("/core/account-privacy/closure"),
        });
    } catch (e) {
      this.setData({ error: e.message || "暂时无法加载，请重试" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onHide() {
    this.setData({ password: "", acknowledged: false });
  },
  input(e) {
    this.setData({ password: e.detail.value });
  },
  acknowledge(e) {
    this.setData({ acknowledged: e.detail.value.includes("yes") });
  },
  agreement(e) {
    wx.navigateTo({
      url: "/pages/agreement/index?type=" + e.currentTarget.dataset.type,
    });
  },
  copyContact() {
    wx.setClipboardData({ data: this.data.supportEmail });
  },
  async closeAccount() {
    if (
      this.data.busy ||
      this.data.loading ||
      !this.data.status?.canClose ||
      !this.data.acknowledged ||
      !this.data.password
    )
      return;
    const userId = String(this.data.user.id),
      password = this.data.password;
    const confirm = await new Promise((resolve) =>
      wx.showModal({
        title: "注销共用账号",
        content:
          "网站和小程序将同时退出，登录账号、个人资料及微信绑定会被清除，账号无法恢复。交易结算等必要记录按协议保留。是否继续？",
        confirmText: "确认注销",
        confirmColor: "#b33a36",
        cancelText: "暂不注销",
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      }),
    );
    if (!confirm || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      await request.post("/core/account-privacy/closure", {
        userId,
        password,
        confirmation: "注销网站及小程序共用账号",
      });
      auth.clear();
      this.setData({
        password: "",
        user: null,
        status: null,
        acknowledged: false,
      });
      wx.showToast({ title: "账号已注销", icon: "success" });
      wx.reLaunch({ url: "/pages/login/index" });
    } catch (e) {
      this.setData({ error: e.message || "注销未完成，请重试", password: "" });
    } finally {
      this.setData({ busy: false });
    }
  },
});
