const screen = require("../../utils/screen");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
Page(
  screen("password", {
    scoped: false,
    data: { oldPassword: "", newPassword: "", confirmPassword: "" },
    async fetch() {
      return {};
    },
    hide() {
      this.setData({ oldPassword: "", newPassword: "", confirmPassword: "" });
    },
    async logout() {
      if (this.data.busy) return;
      this.setData({ busy: true });
      await auth.logout();
      wx.reLaunch({ url: "/pages/login/index" });
    },
    async submit() {
      const { oldPassword, newPassword, confirmPassword } = this.data;
      if (
        !oldPassword ||
        newPassword.length < 8 ||
        newPassword.length > 128 ||
        newPassword !== confirmPassword
      ) {
        this.setData({
          error: "请填写原密码，新密码须为 8–128 位且两次输入一致",
        });
        return;
      }
      if (
        await this.action(async () => {
          await request.post("/core/auth/change-password", {
            oldPassword,
            newPassword,
          });
        }, "密码已修改，请重新登录")
      ) {
        this.setData({ oldPassword: "", newPassword: "", confirmPassword: "" });
        auth.clear();
        wx.reLaunch({ url: "/pages/login/index" });
      }
    },
  }),
);
