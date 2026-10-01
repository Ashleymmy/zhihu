// iOS 风格半屏确认弹层：标题+说明+主操作（可标红）+分离的取消键。
// 由 utils/feedback.js 的 confirm(page, options) 驱动，页面 WXML 挂 <confirm-sheet id="confirmSheet" />。
Component({
  data: {
    visible: false,
    closing: false,
    title: "",
    message: "",
    confirmText: "确认",
    cancelText: "取消",
    danger: false,
  },
  lifetimes: {},
  methods: {
    open(options) {
      if (this._resolver) this._resolver(false);
      this.setData({
        visible: true,
        closing: false,
        title: options.title || "",
        message: options.message || "",
        confirmText: options.confirmText || "确认",
        cancelText: options.cancelText || "取消",
        danger: !!options.danger,
      });
      return new Promise((resolve) => {
        this._resolver = resolve;
      });
    },
    _settle(value) {
      if (this.data.closing) return;
      this.setData({ closing: true });
      const resolver = this._resolver;
      this._resolver = null;
      // 等收起动画播完再真正隐藏并回传结果
      setTimeout(() => {
        this.setData({ visible: false, closing: false });
        if (resolver) resolver(value);
      }, 220);
    },
    onConfirm() {
      this._settle(true);
    },
    onCancel() {
      this._settle(false);
    },
    onMask() {
      this._settle(false);
    },
    noop() {},
  },
});
