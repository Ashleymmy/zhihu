// 正文由 docs 中的 Markdown 生成，日期、主体与条款均以原文为准。
const agreements = require("./documents");

Page({
  data: { title: "", blocks: [] },
  onLoad(options) {
    const isPrivacy = options && options.type === "privacy";
    const document = options && options.type === "withdrawal" ? agreements.withdrawal : isPrivacy ? agreements.privacy : agreements.user;
    this.setData({ title: document.title, blocks: document.blocks });
    wx.setNavigationBarTitle({ title: options && options.type === "withdrawal" ? "提现规则" : isPrivacy ? "隐私协议" : "用户协议" });
  },
});
