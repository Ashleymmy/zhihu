// 底部 tabBar 页面清单与统一跳转：
// tab 页必须 wx.switchTab，其余页面 wx.navigateTo。
const TABS = [
  "/pages/home/index",
  "/pages/college/index",
  "/pages/income/index",
  "/pages/tools/index",
  "/pages/mine/index",
];
// 知乎工作台承载的原生 tab 页：任务/作品/数据已迁到 /pages/zhihu/index 二级入口，
// 首页/我的的快捷入口列表需要额外排除它们，避免与工作台入口重复。
const ZHIHU_HUB = [
  "/pages/keywords/index",
  "/pages/works/index",
  "/pages/wallet/index",
];
function isTab(path) {
  return TABS.indexOf(path) !== -1;
}
function isZhihuHub(path) {
  return ZHIHU_HUB.indexOf(path) !== -1;
}
function go(path) {
  if (!path) return;
  if (isTab(path)) wx.switchTab({ url: path });
  else wx.navigateTo({ url: path });
}
module.exports = { TABS, isTab, isZhihuHub, go };
