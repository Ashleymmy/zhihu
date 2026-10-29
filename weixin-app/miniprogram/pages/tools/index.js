const screen = require("../../utils/screen");
const nav = require("../../utils/nav");
const TOOLS = [
  {
    key: "income",
    iconImg: "/images/icons/data.png",
    name: "数据查询",
    desc: "查询账号收入数据",
    path: "/pages/income/index",
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
      if (!tool || !tool.path) return;
      nav.go(tool.path);
    },
  }),
);
