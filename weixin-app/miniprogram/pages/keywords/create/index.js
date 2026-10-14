const screen = require("../../../utils/screen");
const request = require("../../../utils/request");
const actions = require("../../../utils/actions");
const storyLink = require("../../../utils/story-link");
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
      linkPasting: false,
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
    pasteUrl(e) {
      const index = Number(e.currentTarget.dataset.index), item = this.data.items[index];
      if (!item) return;
      return storyLink.paste(this, () => this.data.items[index] === item, (landingUrl) => {
        const items = this.data.items.slice();
        items[index] = Object.assign({}, item, { landingUrl });
        this.setData({ items });
      });
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
    async confirm() {
      if (this.data.linkPasting) return;
      const ok = await this.action(async ({ scope }) => {
        const task = this.data.options.tasks[this.data.taskIndex];
        const mapping = this.data.options.mappings[this.data.mappingIndex];
        if (!task || !mapping) throw new Error("请先选择任务和渠道");
        if (!this.data.items.length || this.data.items.some(it => !it.keyword.trim()))
          throw new Error("请填写所有关键词");
        // Prepare every row before sending any request. Keep original fields
        // unchanged on failure, including text beyond the API length limit.
        const items = this.data.items.map(it => Object.assign({}, it, { landingUrl: storyLink.prepare(it.landingUrl) }));
        this.setData({ items });
        for (const it of items) {
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
