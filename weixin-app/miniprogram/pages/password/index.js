const screen = require("../../utils/screen");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
Page(
  screen("password", {
    scoped: false,
    data: { oldPassword: "", newPassword: "", confirmPassword: "" },
    async fetch() { return { user: await auth.profile() }; },
    later() {
      if (this.data.busy || this.data.user?.hasPassword !== false) return;
      wx.setStorageSync("zk_password_later_" + this.data.user.id, true);
      wx.switchTab({ url: "/pages/home/index" });
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
        (this.data.user?.hasPassword !== false && !oldPassword) ||
        !/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,16}$/.test(newPassword) ||
        newPassword !== confirmPassword
      ) {
        this.setData({
          error: "新密码须为 8–16 位，包含字母和数字，两次输入需一致；修改时需填写原密码",
        });
        return;
      }
      if (
        await this.action(async () => {
          await request.post(this.data.user.hasPassword === false ? "/core/auth/set-password" : "/core/auth/change-password", {
            ...(this.data.user.hasPassword === false ? {} : { oldPassword }), newPassword,
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
