const screen = require("../../utils/screen");
const request = require("../../utils/request");

Page(
  screen("profile", {
    scoped: false,
    data: {
      inviteUsed: false,
      showInviteModal: false,
      inviteInput: "",
      inviteError: "",
      inviteBusy: false,
      showEditModal: false,
      editModalTitle: "",
      editInput: "",
      editError: "",
      editBusy: false,
      editField: "",
    },
    async fetch({user}) {
      const res = await request.get("/modules/zhihu/invite/status");
      const affiliation = user.role === "creator" ? await request.get("/core/team/affiliation") : null;
      const profile=await request.get("/core/auth/profile");
      return { inviteUsed: res.used, affiliation, user:profile };
    },
    openInviteModal() {
      this.setData({ showInviteModal: true, inviteInput: "", inviteError: "" });
    },
    closeInviteModal() {
      if (this.data.inviteBusy) return;
      this.setData({ showInviteModal: false });
    },
    onInviteInput(e) {
      this.setData({ inviteInput: e.detail.value });
    },
    async submitInvite() {
      const code = this.data.inviteInput.trim().toUpperCase();
      if (!code) {
        this.setData({ inviteError: "请输入邀请码" });
        return;
      }
      if (this.data.inviteBusy) return;
      this.setData({ inviteBusy: true, inviteError: "" });
      try {
        await request.post("/modules/zhihu/invite/use", { code });
        this.setData({ showInviteModal: false, inviteUsed: true });
      } catch (err) {
        this.setData({ inviteError: err.message || "邀请码无效" });
      } finally {
        this.setData({ inviteBusy: false });
      }
    },
    openDisplayNameModal() {
      this.setData({ showEditModal: true, editModalTitle: "修改昵称", editField: "displayName", editInput: this.data.user?.displayName || "", editError: "" });
    },
    openContactModal() {
      this.setData({ showEditModal: true, editModalTitle: "备用联系方式", editField: "contact", editInput: this.data.user?.contact || "", editError: "" });
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
        const userPatch = { [`user.${this.data.editField}`]: updated[this.data.editField] };
        this.setData({ showEditModal: false, ...userPatch });
      } catch (err) {
        this.setData({ editError: err.message || "保存失败" });
      } finally {
        this.setData({ editBusy: false });
      }
    },
  }),
);
