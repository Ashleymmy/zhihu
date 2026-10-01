const screen = require("../../utils/screen");
const request = require("../../utils/request");
const feedback = require("../../utils/feedback");

// 课程无封面上传时按级别使用本地生成的占位封面
const TIER_COVERS = {
  silver: "/images/courses/silver.png",
  gold: "/images/courses/gold.png",
  elite: "/images/courses/elite.png",
};

function presentation(course) {
  const meta = [];
  if (course.duration) meta.push(course.duration);
  if (typeof course.views === "number" && Number.isFinite(course.views) && course.views >= 0)
    meta.push(course.views + " 人学过");
  return Object.assign({}, course, {
    coverSrc: course.cover || TIER_COVERS[course.tier] || TIER_COVERS.silver,
    meta: meta.join(" · "),
  });
}

Page(
  screen("college", {
    scoped: false,
    data: { tiers: [], total: 0, detail: null, detailLoading: false },
    hide() { this.setData({ detail: null }); },
    async fetch() {
      const data = await request.get("/modules/zhihu/courses");
      return {
        tiers: (data.tiers || []).map((tier) =>
          Object.assign({}, tier, {
            courses: (tier.courses || []).map(presentation),
          }),
        ),
        total: data.total || 0,
      };
    },
    async openCourse(e) {
      if (this.data.busy || this.data.loading || this.data.detailLoading || !this.canAct()) return;
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      const version = this._loadVersion;
      this.setData({ detailLoading: true, detail: null });
      feedback.loading("加载课程…");
      try {
        const detail = await request.get("/modules/zhihu/courses/" + id);
        if (version === this._loadVersion && this.canAct()) this.setData({ detail: presentation(detail) });
      } catch (error) {
        if (version === this._loadVersion && this.canAct()) feedback.fail(error.message || "课程加载失败，请稍后重试");
      } finally {
        feedback.hideLoading();
        this.setData({ detailLoading: false });
      }
    },
    closeDetail() {
      this.setData({ detail: null });
    },
    copyCourseUrl() {
      if (!this.canAct() || !this.data.detail || !this.data.detail.url) return;
      wx.setClipboardData({ data: this.data.detail.url, fail: () => feedback.fail("复制失败，请重试") });
    },
  }),
);
