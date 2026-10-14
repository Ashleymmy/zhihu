const screen = require("../../utils/screen");
const auth = require("../../utils/auth");
const avatar = require("../../utils/avatar");
const request = require("../../utils/request");

Page(
  screen("profile", {
    scoped: false,
    data: {
      avatarSrc: avatar.fallback,
      avatarError: "",
      avatarBusy: false,
      inviteUsed: false,
      binding: null,
      showEditModal: false,
      keyboardHeight: 0,
      editModalTitle: "",
      editInput: "",
      editError: "",
      editBusy: false,
      editField: "",
    },
    async fetch({ user }) {
      const res = await request.get("/modules/zhihu/invite/status");
      const affiliation =
        user.role === "creator"
          ? await request.get("/core/team/affiliation")
          : null;
      const profile = await auth.profile();
      const binding = await auth.bindingStatus();
      let avatarSrc = avatar.fallback, avatarError = "";
      try { avatarSrc = await avatar.display(profile, () => this.canAct()); } catch (_) { avatarError = "头像加载失败，点击刷新重试"; }
      return { inviteUsed: res.used, affiliation, user: profile, binding, avatarSrc, avatarError };
    },
    async chooseAvatar(e) {
      const path = e.detail && e.detail.avatarUrl;
      if (!path || this.data.avatarBusy || this.data.editBusy || !this.canAct()) return;
      const ctx = this._context;
      const current = () => this._context === ctx && this.canAct();
      this.setData({ avatarBusy: true, avatarError: "" });
      try {
        const base64 = await avatar.readChosen(path, current);
        if (!current()) return;
        const user = await auth.updateProfile({ base64 }, "/core/auth/avatar");
        if (!current()) return;
        const avatarSrc = await avatar.display(user, current);
        if (current()) this.setData({ user, avatarSrc, notice: "头像已保存" });
      } catch (e) {
        if (current()) this.setData({ avatarError: e.message || "头像保存失败，请重新选择" });
      } finally { this.setData({ avatarBusy: false }); }
    },
    openSocialBinding() {
      if (!this.data.binding || this.data.binding.bound) return;
      wx.navigateTo({ url: "/pages/bind/index?from=profile" });
    },
    openDisplayNameModal() {
      if (!this.canAct() || this.data.avatarBusy || this.data.editBusy) return;
      this.setData({
        showEditModal: true,
        editModalTitle: "修改昵称",
        editField: "displayName",
        editInput: this.data.user?.displayName || "",
        editError: "",
      });
    },
    openContactModal() {
      if (!this.canAct() || this.data.avatarBusy || this.data.editBusy) return;
      this.setData({
        showEditModal: true,
        editModalTitle: "备用联系方式",
        editField: "contact",
        editInput: this.data.user?.contact || "",
        editError: "",
      });
    },
    openPhoneVerification() {
      if (!this.data.user || this.data.user.phoneVerifiedAt) return;
      wx.navigateTo({ url: "/pages/phone-verify/index" });
    },
    closeEditModal() {
      if (this.data.editBusy) return;
      this.setData({ showEditModal: false, keyboardHeight: 0 });
    },
    keyboardChange(e) {
      this.setData({ keyboardHeight: Math.max(0, Number(e.detail.height) || 0) });
    },
    noop() {},
    onEditInput(e) {
      this.setData({ editInput: e.detail.value });
    },
    async submitEdit(e) {
      if (!this.canAct() || this.data.avatarBusy || this.data.editBusy) return;
      const value = String(e?.detail?.value?.profileValue ?? this.data.editInput).trim();
      const ctx = this._context;
      const current = () => this._context === ctx && this.canAct();
      if (!value && this.data.editField !== 'contact') {
        this.setData({ editError: "内容不能为空" });
        return;
      }
      if (this.data.editBusy) return;
      this.setData({ editBusy: true, editError: "" });
      try {
        const body = { [this.data.editField]: value };
        const updated = await auth.updateProfile(body);
        if (current()) this.setData({ showEditModal: false, keyboardHeight: 0, user: updated });
      } catch (err) {
        if (current()) this.setData({ editError: err.message || "保存失败" });
      } finally {
        this.setData({ editBusy: false });
      }
    },
  }),
);
