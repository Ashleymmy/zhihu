const screen = require("../../utils/screen");
const request = require("../../utils/request");
const feedback = require("../../utils/feedback");

// 课程无封面上传时按级别使用本地生成的占位封面
const TIER_COVERS = {
  silver: "/images/courses/silver.png",
  gold: "/images/courses/gold.png",
  elite: "/images/courses/elite.png",
};

Page(
  screen("college", {
    scoped: false,
    data: { tiers: [], total: 0, detail: null, covers: TIER_COVERS },
    async fetch() {
      const data = await request.get("/modules/zhihu/courses");
      return {
        tiers: (data.tiers || []).map((tier) =>
          Object.assign({}, tier, {
            courses: (tier.courses || []).map((course) =>
              Object.assign({}, course, {
                coverSrc:
                  course.cover || TIER_COVERS[course.tier] || TIER_COVERS.silver,
              }),
            ),
          }),
        ),
        total: data.total || 0,
      };
    },
    async openCourse(e) {
      if (this.data.busy || this.data.loading) return;
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      feedback.loading("加载课程…");
      try {
        const detail = await request.get("/modules/zhihu/courses/" + id);
        this.setData({ detail });
      } catch (error) {
        feedback.fail(error.message || "课程加载失败，请稍后重试");
      } finally {
        feedback.hideLoading();
      }
    },
    closeDetail() {
      this.setData({ detail: null });
    },
  }),
);
