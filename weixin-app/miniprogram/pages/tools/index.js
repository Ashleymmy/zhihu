const screen = require("../../utils/screen");
const nav = require("../../utils/nav");
const feedback = require("../../utils/feedback");
const TOOLS = [
  { key: "title", iconImg: "/images/icons/title.png", name: "标题生成", desc: "AI 辅助生成爆款标题", enabled: false },
  { key: "rewrite", iconImg: "/images/icons/rewrite.png", name: "文案改写", desc: "一键改写降重", enabled: false },
  { key: "voice", iconImg: "/images/icons/voice.png", name: "配音工具", desc: "文字转语音配音", enabled: false },
  { key: "cover", iconImg: "/images/icons/cover.png", name: "封面制作", desc: "快速生成封面图", enabled: false },
  { key: "clip", iconImg: "/images/icons/clip.png", name: "视频剪辑", desc: "在线剪辑素材", enabled: false },
  {
    key: "wallet",
    iconImg: "/images/icons/data.png",
    name: "数据查询",
    desc: "查询账号收入数据",
    enabled: true,
    path: "/pages/wallet/index",
  },
].map((tool) =>
  Object.assign({ tint: "#e9f0ed", fg: "#214239" }, tool),
);
Page(
  screen("tools", {
    scoped: false,
    data: { tools: TOOLS },
    async fetch() {},
    openTool(e) {
      const tool = this.data.tools.find(
        (item) => item.key === e.currentTarget.dataset.key,
      );
      if (!tool) return;
      if (!tool.enabled) {
        feedback.toast("该工具暂未开通");
        return;
      }
      nav.go(tool.path);
    },
  }),
);
