const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const keyword = require("../../utils/keyword-actions");
const composition = require("../../utils/composition");
const {upload} = require("../../utils/upload");
const base = "/modules/zhihu";

const PLATFORMS = composition.mediaTypes;
const WORK_TYPES = composition.types.map(t=>t.label);
const CONTENT_TYPES = composition.categories(0).map(t=>t.label);
const TABS = [
  { key: "", label: "全部" },
  { key: "available", label: "可领取" },
  { key: "active,assigned,reserved", label: "进行中" },
  { key: "retired", label: "已完成" },
];

function filterByTab(list, tabKey) {
  if (!tabKey) return list;
  const keys = tabKey.split(",");
  return list.filter((i) => keys.includes(i.lifecycleStatus));
}

Page(
  screen("keywords", {
    infinite: true,
    data: {
      search: "",
      list: [],
      filteredList: [],
      options: { tasks: [], mappings: [], users: [] },
      selected: null,
      actionName: "",
      actionLabel: "",
      targets: [],
      targetIndex: -1,
      reason: "",
      tabIndex: 0,
      tabs: TABS,
      mediaAccount: "",
      workUrl: "",
      platform: "",
      platformIndex: -1,
      platforms: PLATFORMS,
      publishDate: "",
      workTypeIndex: 0,
      workTypes: WORK_TYPES,
      contentTypeIndex: -1,
      contentTypes: CONTENT_TYPES,
      batchMode: false,
      batchItems: [],
      editKeyword: "",
      editLandingUrl: "",
      editMappingIndex: -1,
    },
    async fetch({ user, scope }) {
      const [options, result] = await Promise.all([
        request.get(base + "/attribution-options", scope),
        request.get(
          base + "/keywords",
          Object.assign({}, scope, {
            page: this.data.page,
            pageSize: 20,
            search: this.data.search.trim(),
          }),
        ),
      ]);
      const list = result.list.map((item) => keyword.decorate(user, item, options));
      return {
        options,
        list,
        filteredList: filterByTab(list, TABS[this.data.tabIndex].key),
        total: result.total,
      };
    },
    // 触底加载的合并：累积列表按 id 去重后重算当前页签的过滤结果
    merge(result) {
      const seen = new Set(this.data.list.map((i) => i.id));
      const list = this.data.list.concat(
        (result.list || []).filter((i) => !seen.has(i.id)),
      );
      this.setData({
        options: result.options,
        list,
        filteredList: filterByTab(list, TABS[this.data.tabIndex].key),
        total: result.total,
      });
    },
    show() {
      clearInterval(this._pollTimer);
      this._pollTimer = setInterval(() => this.refresh(), 15000);
    },
    hide() {
      clearInterval(this._pollTimer);
    },
    search() {
      if (!this.data.busy) {
        this.setData({ page: 1 });
        this.load();
      }
    },
    switchTab(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const filteredList = filterByTab(this.data.list, TABS[idx].key);
      this.setData({ tabIndex: idx, filteredList });
    },
    openCreate() {
      if (this.canAct() && !this.data.busy)
        wx.navigateTo({ url: "/pages/keywords/create/index" });
    },
    chooseTarget(e) {
      this.setData({ targetIndex: Number(e.detail.value) });
    },
    choosePlatform(e) {
      const idx = Number(e.detail.value);
      this.setData({ platformIndex: idx, platform: PLATFORMS[idx] });
    },
    chooseWorkType(e) {
      const workTypeIndex=Number(e.currentTarget.dataset.index);
      this.setData({workTypeIndex,contentTypeIndex:-1,contentTypes:composition.categories(workTypeIndex).map(t=>t.label)});
    },
    chooseContentType(e) {
      this.setData({ contentTypeIndex: Number(e.detail.value) });
    },
    chooseEditMapping(e) {
      this.setData({ editMappingIndex: Number(e.detail.value) });
    },
    chooseDate(e) {
      this.setData({ publishDate: e.detail.value });
    },
    choose(e) {
      if (!this.canAct() || this.data.busy) return;
      const item = this.data.filteredList[e.currentTarget.dataset.index],
        name = e.currentTarget.dataset.action;
      if (!item || !keyword.flags(this.data.user, item).includes(name)) return;
      this.setData({
        selected: item,
        actionName: name,
        actionLabel: keyword.labels[name],
        targets: keyword.targets(this.data.user, item, name, this.data.options.users),
        targetIndex: -1,
        reason: "",
        mediaAccount: "",
      workUrl: "",
        platform: "",
        platformIndex: -1,
        publishDate: "",
        workTypeIndex: 0,
        contentTypeIndex: -1,
        contentTypes: CONTENT_TYPES,
        batchMode: false,
        batchItems: [],
        // 编辑重试：预填当前值
        editKeyword: name === "edit-retry" ? item.keyword : "",
        editLandingUrl: name === "edit-retry" ? item.landingUrl || "" : "",
        editMappingIndex:
          name === "edit-retry"
            ? this.data.options.mappings.findIndex(
                (m) => String(m.id) === String(item.mappingId),
              )
            : -1,
        error: "",
      });
    },
    close() {
      if (!this.data.busy) this.setData({ selected: null, error: "" });
    },
    toggleBatchMode(e) {
      this.setData({ batchMode: e.detail.value, batchItems: [] });
    },
    async chooseBatchFile() {
      if (this.data.busy) return;
      await this.action(async ({ scope }) => {
        const fileId=await upload(scope,"composition-xlsx",()=>this.canAct());
        const result=await request.post(base+"/mini-import-works",{...scope,fileId,planId:String(this.data.selected.planId)});
        const invalid=result.rows.filter(r=>r.status==='invalid');
        if(invalid.length)throw new Error('表格有 '+invalid.length+' 条需要补充：'+invalid.slice(0,2).map(r=>(r.errors||[]).join('；')).join('；'));
        const rows=result.rows.filter(r=>r.status==='ready');
        if(rows.some(r=>String(r.input.planId)!==String(this.data.selected.planId)))throw new Error('表格包含其他关键词，请在网站批量登记或按关键词分别上传');
        this.setData({batchItems:rows.map(composition.fromImport),notice:result.duplicate?'已跳过 '+result.duplicate+' 条重复作品':''});
      });
    },
    addBatchItem() {
      this.setData({ batchItems: [...this.data.batchItems, composition.blank()] });
    },
    removeBatchItem(e) {
      const items = [...this.data.batchItems];
      items.splice(Number(e.currentTarget.dataset.index), 1);
      this.setData({ batchItems: items });
    },
    updateBatchItem(e) {
      const items = [...this.data.batchItems];
      items[Number(e.currentTarget.dataset.index)] = { ...items[Number(e.currentTarget.dataset.index)], [e.currentTarget.dataset.field]: e.detail.value };
      this.setData({ batchItems: items });
    },
    batchChoosePlatform(e) {
      const idx = Number(e.currentTarget.dataset.index), pi = Number(e.detail.value);
      const items = [...this.data.batchItems];
      items[idx] = { ...items[idx], platformIndex: pi, platform: PLATFORMS[pi] };
      this.setData({ batchItems: items });
    },
    batchChooseDate(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const items = [...this.data.batchItems];
      items[idx] = { ...items[idx], publishDate: e.detail.value, releaseTime: undefined };
      this.setData({ batchItems: items });
    },
    batchChooseWorkType(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const items = [...this.data.batchItems];
      items[idx] = { ...items[idx], workTypeIndex: Number(e.currentTarget.dataset.wi), contentTypeIndex: -1, categories: composition.categories(Number(e.currentTarget.dataset.wi)) };
      this.setData({ batchItems: items });
    },
    batchChooseContentType(e) {const i=Number(e.currentTarget.dataset.index);const rows=[...this.data.batchItems];rows[i]={...rows[i],contentTypeIndex:Number(e.detail.value)};this.setData({batchItems:rows});},
    async runAction() {
      const item = this.data.selected,
        name = this.data.actionName;
      if (!item) return;
      if (name === "work") {
        const ok=await this.action(async({user,scope})=>{
          if(!keyword.flags(user,item).includes('work'))throw new Error('当前状态不允许登记，请刷新');
          const rows=this.data.batchMode?this.data.batchItems:[{url:this.data.workUrl,mediaAccount:this.data.mediaAccount,platformIndex:this.data.platformIndex,publishDate:this.data.publishDate,workTypeIndex:this.data.workTypeIndex,contentTypeIndex:this.data.contentTypeIndex}];
          if(!rows.length)throw new Error('请至少添加一条作品');
          const inputs=rows.map(row=>composition.input(item.planId,row));
          for(const input of inputs)await actions.post(this,base+'/mini-works',{...scope,...input});
        },'作品已登记，正在提交知乎');
        if(ok){this.setData({selected:null});await this.load();}
        return;
      }
      const ok = await this.action(async ({ user, scope }) => {
        if (!keyword.flags(user, item).includes(name))
          throw new Error("当前状态不允许此操作，请刷新");
        let path,
          payload = Object.assign({}, scope);
        if (["claim", "distribute", "retry-upstream"].includes(name)) {
          path = "/keywords/" + item.id + "/" + name;
          if (name === "distribute") {
            const target = this.data.targets[this.data.targetIndex];
            if (!target) throw new Error("请选择分发成员");
            payload.targetId = String(target.id);
          }
        } else {
          path = "/bindings/" + item.bindingId + "/" + name;
          if (name === "assign") {
            const target = this.data.targets[this.data.targetIndex];
            if (!target) throw new Error("请选择执行人");
            payload.executorId = String(target.id);
          } else {
            payload.reason = this.data.reason.trim();
            if (!payload.reason)
              throw new Error("请填写操作原因或未使用核实依据");
          }
        }
        await actions.post(this, base + path, payload);
      }, "关键词操作已完成");
      if (ok) {
        this.setData({ selected: null });
        await this.load();
      }
    },
  }),
);
