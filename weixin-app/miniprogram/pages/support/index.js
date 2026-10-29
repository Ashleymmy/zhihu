const screen = require("../../utils/screen");
const request = require("../../utils/request");
Page(
  screen("support", {
    scoped: false,
    data: { settings: null },
    async fetch() {
      return { settings: await request.get("/core/support") };
    },
    copyId() {
      if (this.data.user?.userId)
        wx.setClipboardData({ data: this.data.user.userId });
    },
    contactError() {
      this.setData({ error: "暂时无法打开微信客服，请稍后重试。" });
    },
  }),
);
