const screen = require("../../utils/screen");
const auth = require("../../utils/auth");
const permissions = require("../../utils/permissions");
const avatar = require("../../utils/avatar");
const memberSummary = require("../../utils/member-summary");
const ICONS = {
  "join-team": { iconImg: "/images/icons/team.png", tint: "#e9f0ed", fg: "#214239" },
  team: { iconImg: "/images/icons/team.png", tint: "#e9f0ed", fg: "#214239" },
  prices: { iconImg: "/images/icons/prices.png", tint: "#faf3e1", fg: "#c98f1b" },
  admin: { iconImg: "/images/icons/admin.png", tint: "#fbeeea", fg: "#d05a43" },
  reports: { iconImg: "/images/icons/reports.png", tint: "#e8eff5", fg: "#3a6ea5" },
  withdrawals: { iconImg: "/images/icons/withdrawals.png", tint: "#e9f0ed", fg: "#214239" },
  password: { iconImg: "/images/icons/password.png", tint: "#eef0ee", fg: "#7c8883" },
  invite: { iconImg: "/images/icons/invite.png", tint: "#e9f0ed", fg: "#214239" },
};
Page(
  screen("mine", {
    scoped: false,
    data: {
      menus: [],
      avatarSrc: avatar.fallback,
      memberSummary: null, summaryError: '',
    },
    async fetch({ user }) {
      const menus = permissions.menus(user);
      if (permissions.allowed(user, "withdrawals")) menus.push({key:"withdrawals",label:"提现与记录",path:"/pages/withdrawals/index"});
      menus.push({
        key: "invite",
        label: "邀请好友",
        path: "/pages/invite/index",
      });
      menus.push({
        key: "password",
        label: user.hasPassword === false ? "设置登录密码" : "修改密码",
        path: "/pages/password/index",
      });
      let avatarSrc = avatar.fallback;
      try { const profile = await auth.profile(); avatarSrc = await avatar.display(profile, () => this.canAct()); } catch (_) { /* Earnings remain available if profile refresh fails. */ }
      return {
        avatarSrc,
        ...await memberSummary.load(user),
        menus: menus.map((item) =>
          Object.assign(
            {},
            item,
            ICONS[item.key] || { icon: "→", tint: "#eef0ee", fg: "#7c8883" },
          ),
        ),
      };
    },
    openProfile() {
      wx.navigateTo({ url: "/pages/profile/index" });
    },
    openPrivacy() { wx.navigateTo({url:'/pages/privacy/index'}); },
    async logout() {
      if (this.data.busy) return;
      this.setData({ busy: true });
      await auth.logout();
      wx.reLaunch({ url: "/pages/login/index" });
    },
  }),
);
