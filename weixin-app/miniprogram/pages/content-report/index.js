const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const screenshot = require("../../utils/risk-screenshot");
const feedback = require("../../utils/feedback");
const { dateText } = require("../../utils/work-display");
const BASE = "/modules/zhihu/content-tools";
const STATUS = {
  submitted: "已提交，待知乎审核",
  sending: "正在提交",
  failed: "提交失败",
  unknown: "提交结果待核实",
};
const REVIEW = {
  reviewing: "审核中",
  violation: "判定违规",
  normal: "判定正常",
  unknown: "等待确认",
};
Page(
  screen("content-report", {
    data: {
      tab: "new",
      search: "",
      works: [],
      workIndex: -1,
      work: null,
      hasNext: false,
      riskType: 1,
      keyword: "",
      riskUrl: "",
      images: [],
      list: [],
      resultId: "",
      resultRows: [],
      resultHasNext: false,
      resultOffset: 0,
      resultLoaded: false,
      workRiskLoaded: false,
      workRiskRows: [],
      workRiskHasNext: false,
      workRiskOffset: 0,
    },
    async fetch({ scope }) {
      if (this.data.tab === "new") {
        const result = await request.get(BASE + "/works", {
          ...scope,
          search: this.data.search,
          page: this.data.page,
        });
        const works = result.list.map((item) => ({
          ...item,
          label: item.keyword + " · " + (item.title || "推广作品"),
        }));
        return {
          works,
          workIndex: works.findIndex((item) => item.id === this.data.work?.id),
          hasNext: result.hasNext,
        };
      }
      const result = await request.get(BASE + "/reports", {
        ...scope,
        page: this.data.page,
      });
      return {
        list: result.list.map((item) => ({
          ...item,
          statusText: STATUS[item.status] || "等待确认",
          typeText: item.riskType === 2 ? "搬运内容" : "违规全文",
          createdText: dateText(item.createdAt),
        })),
        hasNext: result.hasNext,
      };
    },
    switchTab(e) {
      if (this.data.busy || this.data.loading || !this.canAct()) return;
      this.setData({
        tab: e.currentTarget.dataset.tab,
        page: 1,
        list: [],
        resultId: "",
        resultLoaded: false,
      });
      return this.load();
    },
    chooseWork(e) {
      if (!this.canAct() || this.data.busy) return;
      const index = Number(e.detail.value),
        work = this.data.works[index];
      if (work)
        this.setData({
          workIndex: index,
          work,
          images: [],
          workRiskLoaded: false,
          workRiskRows: [],
        });
    },
    changeType(e) {
      if (this.canAct() && !this.data.busy)
        this.setData({ riskType: Number(e.currentTarget.dataset.type) });
    },
    searchWorks() {
      if (!this.canAct() || this.data.busy || this.data.loading) return;
      this.setData({ page: 1, works: [], workIndex: -1 });
      return this.load();
    },
    nextPage() {
      if (
        !this.canAct() ||
        this.data.busy ||
        this.data.loading ||
        !this.data.hasNext
      )
        return;
      this.setData({
        page: this.data.page + 1,
        resultId: "",
        resultLoaded: false,
      });
      return this.load();
    },
    prevPage() {
      if (
        !this.canAct() ||
        this.data.busy ||
        this.data.loading ||
        this.data.page <= 1
      )
        return;
      this.setData({
        page: this.data.page - 1,
        resultId: "",
        resultLoaded: false,
      });
      return this.load();
    },
    async addImage() {
      if (
        !this.canAct() ||
        this.data.busy ||
        this._choosing ||
        this.data.images.length >= 3
      )
        return;
      this._choosing = true;
      try {
        const chosen = await wx.chooseMedia({
          count: 1,
          mediaType: ["image"],
          sourceType: ["album", "camera"],
          sizeType: ["compressed"],
        });
        const file = chosen.tempFiles && chosen.tempFiles[0];
        if (!file || !this.canAct()) return;
        await this.action(async ({ scope }) => {
          const image = await screenshot.encode(file.tempFilePath, () =>
            this.canAct(),
          );
          const uploaded = await request.post(BASE + "/images", {
            ...scope,
            base64: image.base64,
          });
          if (this.canAct())
            this.setData({
              images: this.data.images.concat({
                id: uploaded.id,
                path: image.path,
              }),
            });
        }, "截图已添加");
      } catch (error) {
        if (!/cancel/i.test(error.errMsg || "") && this.canAct())
          this.setData({ error: error.message || "无法选择截图，请重试" });
      } finally {
        this._choosing = false;
      }
    },
    removeImage(e) {
      if (this.canAct() && !this.data.busy)
        this.setData({
          images: this.data.images.filter(
            (item) => item.id !== e.currentTarget.dataset.id,
          ),
        });
    },
    previewImage(e) {
      wx.previewImage({
        current: e.currentTarget.dataset.path,
        urls: this.data.images.map((item) => item.path),
      });
    },
    async submit() {
      const done = await this.action(async ({ scope }) => {
        if (!this.data.work) throw new Error("请先选择自己的原作品");
        const keyword = this.data.keyword.trim(),
          riskUrl = this.data.riskUrl.trim();
        if (!keyword) throw new Error("请填写需要举报的风险词");
        if (this.data.riskType === 2 && !actions.publicUrl(riskUrl))
          throw new Error("请填写搬运内容的完整网页链接");
        if (!this.data.images.length) throw new Error("请添加至少一张证据截图");
        const report = {
          compositionId: this.data.work.id,
          keyword,
          riskType: this.data.riskType,
          damageKeyword: this.data.work.keyword,
          imageIds: this.data.images.map((item) => item.id),
          ...(riskUrl ? { riskUrl } : {}),
        };
        const result = await actions.post(this, BASE + "/reports", {
          ...scope,
          report,
        });
        if (this.canAct()) {
          this.setData({
            tab: "history",
            page: 1,
            list: [],
            resultId: "",
            resultLoaded: false,
          });
          if (["submitted", "sending"].includes(result.status))
            this.setData({
              keyword: "",
              riskUrl: "",
              images: [],
              work: null,
              workIndex: -1,
            });
          feedback.toast(STATUS[result.status] || "举报已记录");
        }
      }, "");
      if (done) await this.load();
    },
    async queryResult(e) {
      const id = e.currentTarget.dataset.id;
      const offset = e.currentTarget.dataset.more
        ? this.data.resultOffset + 100
        : 0;
      await this.action(async ({ scope }) => {
        const result = await request.get(BASE + "/reports/" + id + "/result", {
          ...scope,
          offset,
        });
        if (this.canAct())
          this.setData({
            resultId: id,
            resultLoaded: true,
            resultOffset: offset,
            resultHasNext: result.hasNext,
            resultRows: (offset ? this.data.resultRows : []).concat(
              result.list.map((item, index) => ({
                ...item,
                key: offset + index,
                statusText: REVIEW[item.status] || "等待确认",
              })),
            ),
          });
      }, "");
    },
    async queryWorkRisk(e) {
      const work = this.data.work;
      if (!work) return;
      const offset = e.currentTarget.dataset.more
        ? this.data.workRiskOffset + 100
        : 0;
      await this.action(async ({ scope }) => {
        const result = await request.get(
          BASE + "/works/" + work.id + "/risks",
          { ...scope, offset },
        );
        if (this.canAct())
          this.setData({
            workRiskLoaded: true,
            workRiskOffset: offset,
            workRiskHasNext: result.hasNext,
            workRiskRows: (offset ? this.data.workRiskRows : []).concat(
              result.list.map((item, index) => ({
                ...item,
                key: offset + index,
                statusText: REVIEW[item.status] || "等待确认",
              })),
            ),
          });
      }, "");
    },
    async retryReport(e) {
      if (!this.canAct() || this.data.busy || this.data.loading) return;
      const record = this.data.list.find(
        (item) => item.id === e.currentTarget.dataset.id,
      );
      if (!record) return;
      if (
        record.status === "unknown" &&
        !(this.data.resultId === record.id && this.data.resultLoaded)
      ) {
        await this.queryResult(e);
        return;
      }
      const confirm = await wx.showModal({
        title: record.status === "unknown" ? "核实后重新提交" : "重新提交举报",
        content:
          record.status === "unknown"
            ? "请先核实知乎未收到这次举报，确认后再重新提交。"
            : "将使用本次举报的作品和证据截图重新提交知乎。",
        confirmText: record.status === "unknown" ? "确认未收到" : "重新提交",
      });
      if (!confirm.confirm) return;
      const done = await this.action(async ({ scope }) => {
        await request.post(BASE + "/reports/" + record.id + "/retry", {
          ...scope,
          attempt: record.attempt,
          checkedNotReceived: record.status === "unknown",
        });
      }, "举报状态已更新");
      if (done) await this.load();
    },
  }),
);
