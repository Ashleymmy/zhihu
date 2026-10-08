const screen = require("../../../utils/screen");
const request = require("../../../utils/request");
const actions = require("../../../utils/actions");
const base = "/modules/zhihu";
Page(
  screen("keywords-create", {
    scoped: true,
    data: {
      items: [{ keyword: "", landingUrl: "", novelTitle: "" }],
      taskIndex: 0,
      mappingIndex: 0,
      options: { tasks: [], mappings: [] },
      showPickers: false,
    },
    async fetch({ scope }) {
      const options = await request.get(base + "/attribution-options", scope);
      if(options.channels?.length) options.mappings=options.channels.map(c=>({...c,channelName:c.name,channelId:c.id}));
      return {
        options,
        showPickers: options.tasks.length > 1 || options.mappings.length > 1,
      };
    },
    inputKeyword(e) {
      const index = e.currentTarget.dataset.index;
      const items = this.data.items.slice();
      items[index] = Object.assign({}, items[index], { keyword: e.detail.value });
      this.setData({ items });
    },
    inputTitle(e) {
      const index = e.currentTarget.dataset.index;
      const items = this.data.items.slice();
      items[index] = Object.assign({}, items[index], { novelTitle: e.detail.value });
      this.setData({ items });
    },
    inputUrl(e) {
      const index = e.currentTarget.dataset.index;
      const items = this.data.items.slice();
      items[index] = Object.assign({}, items[index], { landingUrl: e.detail.value });
      this.setData({ items });
    },
    addItem() {
      if (this.data.busy) return;
      this.setData({ items: this.data.items.concat([{ keyword: "", landingUrl: "", novelTitle: "" }]) });
    },
    removeItem(e) {
      if (this.data.busy || this.data.items.length <= 1) return;
      const index = e.currentTarget.dataset.index;
      const items = this.data.items.slice();
      items.splice(index, 1);
      this.setData({ items });
    },
    chooseTask(e) {
      this.setData({ taskIndex: Number(e.detail.value) });
    },
    chooseMapping(e) {
      this.setData({ mappingIndex: Number(e.detail.value) });
    },
    canConfirm() {
      return this.data.items.every(
        (it) => it.keyword.trim() && actions.publicUrl(it.landingUrl.trim()),
      );
    },
    async confirm() {
      const ok = await this.action(async ({ scope }) => {
        const task = this.data.options.tasks[this.data.taskIndex];
        const mapping = this.data.options.mappings[this.data.mappingIndex];
        if (!task || !mapping) throw new Error("请先选择任务和渠道");
        if (!this.canConfirm()) throw new Error("请检查所有关键词和文章链接");
        for (const it of this.data.items) {
          await actions.post(this, base + "/keywords", {
            ...scope,
            keyword: it.keyword.trim(),
            landingUrl: it.landingUrl.trim(),
            novel: {title: (it.novelTitle || "").trim()},
            taskId: String(task.id),
            ...(mapping.channelId?{channelId:String(mapping.channelId)}:{mappingId:String(mapping.id)}),
            popularizeType: 0,
          });
        }
      }, "关键词创建请求已提交");
      if (ok) wx.navigateBack();
    },
  }),
);
