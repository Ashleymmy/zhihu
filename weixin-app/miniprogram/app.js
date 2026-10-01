const auth = require("./utils/auth");
App({
  globalData: { user: null, scope: { projectId: "", accountId: "" } },
  onLaunch() {
    this.readyPromise = auth.ensure().catch(() => null);
  },
  handleUnauthorized() {
    auth.clear();
    const pages = getCurrentPages();
    if (!pages.length || pages[pages.length - 1].route !== "pages/login/index")
      wx.reLaunch({ url: "/pages/login/index" });
  },
});
