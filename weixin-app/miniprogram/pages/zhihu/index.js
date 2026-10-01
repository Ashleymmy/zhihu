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
    key: "wallet",
    label: "数据",
    path: "/pages/wallet/index",
    iconImg: "/images/icons/data.png",
    tint: "#e8eff5",
    fg: "#3a6ea5",
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
