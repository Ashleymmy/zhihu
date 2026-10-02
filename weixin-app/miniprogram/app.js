const auth = require("./utils/auth");
const invitation = require("./utils/invitation");
App({
  globalData: { user: null, scope: { projectId: "", accountId: "" } },
  onShow(options = {}) {
    if (
      options.path === "pages/register/index" ||
      options.path === "pages/login/index"
    )
      invitation.capture(options.query || {});
  },
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
