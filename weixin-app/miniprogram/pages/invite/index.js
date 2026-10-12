const screen = require("../../utils/screen");
const request = require("../../utils/request");
const memberSummary = require("../../utils/member-summary");
Page(
  screen("invite", {
    scoped: false,
    data: { code: "", usageCount: 0, records: [], memberSummary:null, summaryError:'' },
    async fetch({ scope, user }) {
      const [me, history, summary] = await Promise.all([
        request.get("/modules/zhihu/invite/me", scope),
        request.get("/modules/zhihu/invite/rewards", scope),
        memberSummary.load(user, true),
      ]);
      return {
        ...summary,
        code: me.code || "",
        usageCount: me.usageCount || 0,
        records: (history.records || []).map((r) =>
          Object.assign({}, r, { timeText: String(r.time || "").slice(0, 10) }),
        ),
      };
    },
    onShareAppMessage() {
      return {
        title: "TIMO 推广平台｜连接好内容与推广机会",
        // 固定封面避免微信截取当前页面，把邀请人数或个人记录带给收件人。
        imageUrl: "/images/share/timo-intro.png",
        path: this.data.code
          ? "/pages/register/index?invite=" + encodeURIComponent(this.data.code)
          : "/pages/home/index",
      };
    },
  }),
);
