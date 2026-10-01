// 全局交互反馈统一出口：iOS 风格的轻提示、结果反馈、危险操作确认与触觉反馈。
// 页面一律走这里，不再直接调 wx.showToast / wx.showModal，保证全 App 反馈一致。
//
// 危险操作确认用 iOS 半屏 ActionSheet 风格（微信原生 showModal 样式不可控）：
// 页面在 WXML 挂一个 <confirm-sheet />，本模块负责驱动它。
// 确认与点击伴随 wx.vibrateShort 触觉反馈（iOS 习惯），失败静默降级不影响流程。
function haptic(kind = "light") {
  try {
    if (wx.vibrateShort)
      wx.vibrateShort({ type: kind === "heavy" ? "heavy" : "light" });
  } catch (_) {
    /* 部分基础库不支持，忽略 */
  }
}

function toast(title, icon = "none") {
  return new Promise((resolve) => {
    wx.showToast({
      title: String(title || ""),
      icon,
      duration: icon === "none" ? 2000 : 1500,
      mask: false,
      complete: resolve,
    });
  });
}

function success(title) {
  haptic("light");
  const text = String(title || "操作已完成");
  // icon 模式下 toast 只能完整显示约 7 个汉字，长文案降级为纯文本
  return toast(text, text.length <= 7 ? "success" : "none");
}

function fail(title) {
  haptic("light");
  return toast(title || "操作失败，请重试", "none");
}

function loading(title) {
  wx.showLoading({ title: String(title || "加载中…"), mask: true });
}

function hideLoading() {
  try {
    wx.hideLoading();
  } catch (_) {
    /* 未在 loading 时调用会报错，忽略 */
  }
}

// 打开挂在页面上的 iOS 风格确认弹层。
// options: { title, message, confirmText, danger, cancelText }
// 返回 Promise<boolean>：true=确认，false=取消/点遮罩。
function confirm(page, options) {
  const sheet = page.selectComponent && page.selectComponent("#confirmSheet");
  if (sheet && sheet.open) {
    haptic("light");
    return sheet.open(options);
  }
  // 页面未挂组件（或测试环境无组件树）时降级为原生 modal，保证流程不被阻断。
  // 兼容回调与 Promise 两种风格的 wx.showModal 实现，先到的结果生效。
  return new Promise((resolve) => {
    const done = (value) => resolve(!!value);
    let returned;
    try {
      returned = wx.showModal({
        title: options.title || "",
        content: options.message || "",
        confirmText: options.confirmText || "确认",
        confirmColor: options.danger ? "#d05a43" : "#214239",
        success: (res) => done(!!(res && res.confirm)),
        fail: () => done(false),
      });
    } catch (_) {
      done(false);
      return;
    }
    if (returned && typeof returned.then === "function")
      returned.then((res) => done(!!(res && res.confirm)), () => done(false));
  });
}

module.exports = { haptic, toast, success, fail, loading, hideLoading, confirm };
