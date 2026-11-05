const screen = require("../../utils/screen");
const request = require("../../utils/request");
const feedback = require("../../utils/feedback");
const BASE = "/modules/zhihu/content-tools";
Page(
  screen("salt-books", {
    infinite: true,
    data: {
      boards: [],
      boardIndex: 0,
      boardId: "",
      boardName: "",
      updatedAt: "",
      list: [],
      selected: null,
    },
    async fetch({ scope }) {
      const boards = this.data.boards.length
        ? this.data.boards
        : (await request.get(BASE + "/boards", scope)).list;
      const boardIndex = Math.max(
        0,
        boards.findIndex((item) => item.id === this.data.boardId),
      );
      const board = boards[boardIndex];
      if (!board) return { boards: [], boardId: "", list: [], total: 0 };
      const offset = (this.data.page - 1) * 20;
      const result = await request.get(
        BASE + "/boards/" + encodeURIComponent(board.id) + "/contents",
        { ...scope, offset, limit: 20 },
      );
      return {
        boards,
        boardIndex,
        boardId: board.id,
        boardName: board.name,
        updatedAt: board.updatedAt,
        total: result.total,
        hasNext: result.hasNext,
        list: result.list.map((item, index) => ({
          ...item,
          rank: offset + index + 1,
          topicText: (item.topics || []).join(" · "),
        })),
      };
    },
    chooseBoard(e) {
      if (this.data.busy || this.data.loading || !this.canAct()) return;
      const board = this.data.boards[Number(e.detail.value)];
      if (!board) return;
      this.setData({
        boardId: board.id,
        boardIndex: Number(e.detail.value),
        list: [],
        total: 0,
        selected: null,
      });
      return this.load();
    },
    async onPullDownRefresh() {
      if (this.data.loading || this.data.busy) return wx.stopPullDownRefresh();
      this.setData({ boards: [], selected: null, list: [], total: 0 });
      try {
        await this.load();
      } finally {
        wx.stopPullDownRefresh();
      }
    },
    showBook(e) {
      if (!this.canAct()) return;
      const book = this.data.list.find(
        (item) => item.id === e.currentTarget.dataset.id,
      );
      if (book) this.setData({ selected: book });
    },
    closeBook() {
      this.setData({ selected: null });
    },
    preventScroll() {},
    copyOriginal(e) {
      if (!this.canAct()) return;
      const book = this.data.list.find(
        (item) => item.id === e.currentTarget.dataset.id,
      );
      if (!book || !/^https?:\/\//.test(book.url)) return;
      wx.setClipboardData({
        data: book.url,
        success: () => feedback.toast("原文链接已复制"),
        fail: () => {
          if (this.canAct()) {
            feedback.toast("复制失败，可长按原文链接复制");
            this.setData({
              selected: book,
              notice: "复制失败，可长按详情里的原文链接手动复制。",
            });
          }
        },
      });
    },
  }),
);
