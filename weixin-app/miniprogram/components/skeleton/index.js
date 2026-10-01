// 骨架屏：加载中的页面占位，替代"正在加载…"纯文案。
// type: page（标题+多卡，默认）/ cards（纯列表卡）/ stats（三列指标+列表）
// rows: 列表卡片数量
Component({
  properties: {
    type: { type: String, value: "page" },
    rows: { type: Number, value: 3 },
  },
});
