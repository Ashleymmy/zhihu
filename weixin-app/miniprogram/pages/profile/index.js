const screen = require("../../utils/screen");
const auth = require("../../utils/auth");
const request = require("../../utils/request");

Page(
  screen("profile", {
    scoped: false,
    data: {
      inviteUsed: false,
      binding: null,
      showEditModal: false,
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
      const profile = await request.get("/core/auth/profile");
      const binding = await auth.bindingStatus();
      return { inviteUsed: res.used, affiliation, user: profile, binding };
    },
    openSocialBinding() {
      if (!this.data.binding || this.data.binding.bound) return;
      wx.navigateTo({ url: "/pages/bind/index?from=profile" });
    },
    openDisplayNameModal() {
      this.setData({
        showEditModal: true,
        editModalTitle: "修改昵称",
        editField: "displayName",
        editInput: this.data.user?.displayName || "",
        editError: "",
      });
    },
    openContactModal() {
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
      this.setData({ showEditModal: false });
    },
    noop() {},
    onEditInput(e) {
      this.setData({ editInput: e.detail.value });
    },
    async submitEdit() {
      const value = this.data.editInput.trim();
      if (!value) {
        this.setData({ editError: "内容不能为空" });
        return;
      }
      if (this.data.editBusy) return;
      this.setData({ editBusy: true, editError: "" });
      try {
        const body = { [this.data.editField]: value };
        const updated = await request.post("/core/auth/profile", body);
        const userPatch = {
          [`user.${this.data.editField}`]: updated[this.data.editField],
        };
        this.setData({ showEditModal: false, ...userPatch });
      } catch (err) {
        this.setData({ editError: err.message || "保存失败" });
      } finally {
        this.setData({ editBusy: false });
      }
    },
  }),
);
