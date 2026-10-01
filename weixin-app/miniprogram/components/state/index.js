// 空态/异常态展示：插画 + 说明 + 可选引导按钮。
// type: empty（默认）/ error
// text: 说明文案
// guideText / guidePath: 引导按钮文案与跳转路径（tab 页自动 switchTab）
Component({
  properties: {
    type: { type: String, value: "empty" },
    text: { type: String, value: "" },
    guideText: { type: String, value: "" },
    guidePath: { type: String, value: "" },
  },
  methods: {
    goGuide() {
      const path = this.data.guidePath;
      if (!path) return;
      const TABS = [
        "/pages/home/index",
        "/pages/college/index",
        "/pages/income/index",
        "/pages/tools/index",
        "/pages/mine/index",
      ];
      if (TABS.indexOf(path) !== -1) wx.switchTab({ url: path });
      else wx.navigateTo({ url: path });
    },
  },
});
