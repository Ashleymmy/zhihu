// 正文由 docs 中的两份 Markdown 生成，日期、主体与条款均以原文为准。
const agreements = require("./documents");

Page({
  data: { title: "", blocks: [] },
  onLoad(options) {
    const isPrivacy = options && options.type === "privacy";
    const document = isPrivacy ? agreements.privacy : agreements.user;
    this.setData({ title: document.title, blocks: document.blocks });
    wx.setNavigationBarTitle({ title: isPrivacy ? "隐私协议" : "用户协议" });
  },
});
