const screen = require("../../utils/screen");
const permissions = require("../../utils/permissions");
const ITEMS = [
  {
    key: "keywords",
    label: "任务",
    path: "/pages/keywords/index",
    iconImg: "/images/icons/keywords.png",
    tint: "#e9f0ed",
    fg: "#214239",
  },
  {
    key: "works",
    label: "作品",
    path: "/pages/works/index",
    iconImg: "/images/icons/works.png",
    tint: "#faf3e1",
    fg: "#c98f1b",
  },
  {
    key: "work-data",
    label: "数据",
    path: "/pages/work-data/index",
    iconImg: "/images/icons/data.png",
    tint: "#e8eff5",
    fg: "#3a6ea5",
  },
  {
    key: "salt-books",
    label: "选书榜单",
    desc: "找小说 · 复制原文链接",
    path: "/pages/salt-books/index",
    iconImg: "/images/icons/cover.png",
    tint: "#faf3e1",
  },
  {
    key: "content-report",
    label: "内容举报",
    desc: "举报违规内容 · 查看我的举报",
    path: "/pages/content-report/index",
    iconImg: "/images/icons/admin.png",
    tint: "#e8eff5",
  },
];
Page(
  screen("zhihu", {
    scoped: false,
    data: { items: [] },
    async fetch({ user }) {
      return {
        items: ITEMS.filter((item) => permissions.allowed(user, item.key)),
      };
    },
  }),
);
