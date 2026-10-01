const permissions = require("../../utils/permissions");
const nav = require("../../utils/nav");
Component({
  properties: {
    user: { type: Object, value: null },
    active: { type: String, value: "home" },
  },
  data: { items: [] },
  observers: {
    user(user) {
      this.setData({ items: permissions.menus(user) });
    },
  },
  methods: {
    open(e) {
      const path = e.currentTarget.dataset.path;
      const pages = getCurrentPages();
      if (
        !path ||
        (pages.length && "/" + pages[pages.length - 1].route === path)
      )
        return;
      nav.go(path);
    },
    home() {
      wx.switchTab({ url: "/pages/home/index" });
    },
  },
});
