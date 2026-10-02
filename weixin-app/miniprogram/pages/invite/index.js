const screen = require("../../utils/screen");
const request = require("../../utils/request");
Page(
  screen("invite", {
    scoped: false,
    data: { code: "", usageCount: 0, records: [] },
    async fetch({ scope }) {
      const [me, history] = await Promise.all([
        request.get("/modules/zhihu/invite/me", scope),
        request.get("/modules/zhihu/invite/rewards", scope),
      ]);
      return {
        code: me.code || "",
        usageCount: me.usageCount || 0,
        records: (history.records || []).map((r) =>
          Object.assign({}, r, { timeText: String(r.time || "").slice(0, 10) }),
        ),
      };
    },
    onShareAppMessage() {
      return {
        title: "邀请你加入 TIMO 推广平台",
        path: this.data.code
          ? "/pages/register/index?invite=" + encodeURIComponent(this.data.code)
          : "/pages/home/index",
      };
    },
  }),
);
