const screen = require("../../utils/screen");
const scopes = require("../../utils/scope");
const permissions = require("../../utils/permissions");
const request = require("../../utils/request");
const feedback = require("../../utils/feedback");
const nav = require("../../utils/nav");
const ICONS = {
  team: { iconImg: "/images/icons/team.png", tint: "#e9f0ed", fg: "#214239" },
  prices: { iconImg: "/images/icons/prices.png", tint: "#faf3e1", fg: "#c98f1b" },
  admin: { iconImg: "/images/icons/admin.png", tint: "#fbeeea", fg: "#d05a43" },
  reports: { iconImg: "/images/icons/reports.png", tint: "#e8eff5", fg: "#3a6ea5" },
};
// 业务渠道矩阵：知乎已开通，其余渠道占位，接入后改为 open: true 并配置 path
// logo 为官方品牌资产（拉取自公开 favicon/维基），仅作渠道标识
const CHANNELS = [
  {
    key: "zhihu",
    name: "知乎",
    desc: "关键词推广 · 作品审核 · 收益结算",
    icon: "知",
    logo: "/images/channels/zhihu.png",
    tint: "#e6efff",
    fg: "#0c63e4",
    open: true,
  },
  {
    key: "fanqie",
    name: "番茄小说",
    desc: "小说推文 · 暂未开通",
    icon: "番",
    logo: "/images/channels/fanqie.png",
    tint: "#fdeee6",
    fg: "#e2543a",
    open: false,
  },
  {
    key: "douyin",
    name: "抖音",
    desc: "短视频挂载 · 暂未开通",
    icon: "抖",
    logo: "/images/channels/douyin.png",
    tint: "#e8e9ec",
    fg: "#1d2723",
    open: false,
  },
  {
    key: "xiaohongshu",
    name: "小红书",
    desc: "种草推广 · 暂未开通",
    icon: "红",
    logo: "/images/channels/xiaohongshu.png",
    tint: "#fdeaec",
    fg: "#d43a4a",
    open: false,
  },
];
// 首页 banner 占位海报（scripts/gen-placeholders.cjs 生成），正式运营图就绪后替换 image
const BANNERS = [
  {
    key: "guide",
    image: "/images/banners/banner-1.png",
    title: "新人第一课",
    subtitle: "10 分钟跑通关键词推广全流程",
    path: "/pages/college/index",
  },
  {
    key: "income",
    image: "/images/banners/banner-2.png",
    title: "收益与提现",
    subtitle: "账单确认、款项到账并开放后可申请提现",
    path: "/pages/income/index",
  },
  {
    key: "keywords",
    image: "/images/banners/banner-3.png",
    title: "去领关键词",
    subtitle: "选题 · 发布 · 回填 · 结算",
    path: "/pages/keywords/index",
  },
];
Page(
  screen("home", {
    scoped: false,
    data: {
      menus: [],
      channels: CHANNELS.filter(channel=>channel.open),
      banners: BANNERS,
      announcements: [],
      showAnnouncements: false,
      summary: null,
      projects: [],
      accounts: [],
      projectIndex: 0,
      accountIndex: 0,
      scopeNotice: "",
    },
    openChannel(e) {
      const channel = CHANNELS.find(
        (item) => item.key === e.currentTarget.dataset.key,
      );
      if (!channel || !channel.open) {
        feedback.toast("该渠道暂未开通");
        return;
      }
      if (this.data.guest || !this._context) {
        wx.navigateTo({ url: "/pages/login/index" });
        return;
      }
      // 知乎业务由二级工作台承载，任务/作品/数据不再挂在全局 tabBar 上
      wx.navigateTo({ url: "/pages/zhihu/index" });
    },
    // 首页所有业务入口对游客的登录引导统一走这里
    guard(e) {
      if (this.data.guest || !this._context) {
        wx.navigateTo({ url: "/pages/login/index" });
        return false;
      }
      return true;
    },
    toSearch() {
      if (!this.guard()) return;
      wx.navigateTo({ url: "/pages/keywords/index" });
    },
    openBanner(e) {
      if (!this.guard()) return;
      const path = e.currentTarget.dataset.path;
      if (path) nav.go(path);
    },
    openAnnouncements() {
      this.setData({ showAnnouncements: true });
    },
    closeAnnouncements() {
      this.setData({ showAnnouncements: false });
    },
    async fetch({ user }) {
      const view = await scopes.load(true);
      // 达人/团长在首页展示可提现余额摘要；失败不阻塞首页其它内容
      let balance = null;
      if (view && view.scope.accountId && !permissions.isAdmin(user)) {
        try {
          const finance = await request.get(
            "/core/finance",
            Object.assign({}, view.scope, { moduleId: "zhihu", page: 1 }),
          );
          balance = finance && finance.balance ? finance.balance : null;
          // 后端金额是 4 位小数字符串，展示统一两位
          if (balance)
            for (const key of ["available", "held", "processing", "paid"])
              balance[key] = Number(balance[key] || 0).toFixed(2);
        } catch (error) {
          balance = null;
        }
      }
      // 工作台摘要（今日预估/进行中/待审核）；失败不阻塞
      let summary = null;
      if (view && view.scope.accountId) {
        try {
          summary = await request.get(
            "/modules/zhihu/home-summary",
            view.scope,
          );
          // 后端金额是 4 位小数字符串，展示统一两位
          const amount = permissions.isAdmin(user) ? summary.todayPayable : summary.todayReceivable;
          summary.todayAmount = amount == null ? '—' : Number(amount).toFixed(2);
          summary.keywordCount = summary.keywords == null ? '—' : summary.keywords;
          summary.workCount = summary.works == null ? '—' : summary.works;
        } catch (error) {
          summary = null;
        }
      }
      // 真实运营公告；失败或为空时公告条整体隐藏
      let announcements = [];
      try {
        announcements = await request.get("/core/announcements/active");
      } catch (error) {
        announcements = [];
      }
      return Object.assign({}, view || {}, {
        // tabBar 已改为学院/收益/工具，知乎任务/作品/数据迁到工作台二级入口，
        // permissions.menus() 已排除 tab 与知乎工作台入口，快捷入口只保留其余角色功能
        menus: permissions
          .menus(user)
          .map((item) =>
            Object.assign(
              {},
              item,
              ICONS[item.key] || { icon: "→", tint: "#eef0ee", fg: "#7c8883" },
            ),
          ),
        scopeNotice: view ? view.notice : "",
        balance,
        summary,
        announcements: Array.isArray(announcements)
          ? announcements.slice(0, 5)
          : [],
      });
    },
    async onProjectChange(e) {
      if (this.data.busy || !this.canAct()) return;
      const project = this.data.projects[Number(e.detail.value)];
      if (!project) return;
      const version = (this._selection = (this._selection || 0) + 1);
      this.setData({
        loading: true,
        error: "",
        accounts: [],
        balance: null, summary: null,
        projectIndex: Number(e.detail.value),
      });
      try {
        const view = await scopes.load(true, String(project.id));
        if (version === this._selection && view)
          { this.setData(Object.assign({}, view, { scopeNotice: view.notice })); await this.load(); }
      } catch (error) {
        if (version === this._selection) this.setData({ error: error.message });
      } finally {
        if (version === this._selection) this.setData({ loading: false });
      }
    },
    onAccountChange(e) {
      const view = scopes.selectAccount(Number(e.detail.value));
      if (view) {this.setData({...view,balance:null,summary:null});return this.load();}
    },
  }),
);
