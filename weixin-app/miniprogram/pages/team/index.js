const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const permissions = require("../../utils/permissions");
const feedback = require("../../utils/feedback");
Page(
  screen("team", {
    scoped: false,
    data: {
      members: [],
      applications: [],
      formOpen: false,
      credentials: null,
      leaders: [],
      leaderIndex: -1,
      roleIndex: 0,
      roles: ["达人", "团长"],
      form: { username: "", displayName: "", phone: "" },
      selected: null,
      editName: "",
      editPhone: "",
      resetPassword: "",
      projects: [], projectSelection: [],
    },
    async fetch({ user }) {
      const [members, applications, projects] = await Promise.all([
        request.get("/core/team/members"),
        request.get("/core/team/applications"),
        request.get("/core/projects"),
      ]);
      return {
        projects: projects.filter(p=>p.isEnabled),
        members: members.map((item) =>
          Object.assign({}, item, {
            roleText: permissions.roleLabel(item),
            active: !!item.isActive,
          }),
        ),
        applications: applications.filter((a) => a.status === "pending"),
        leaders: members.filter((m) => m.role === "leader" && m.isActive),
        isAdmin: permissions.isAdmin(user),
      };
    },
    hide() {
      this.setData({ credentials: null });
    },
    toggleForm() {
      if (this.canAct() && !this.data.busy)
        this.setData({ formOpen: !this.data.formOpen, error: "" });
    },
    chooseRole(e) {
      this.setData({ roleIndex: Number(e.detail.value), leaderIndex: -1 });
    },
    chooseLeader(e) {
      this.setData({ leaderIndex: Number(e.detail.value) });
    },
    clearLeader() {
      this.setData({ leaderIndex: -1 });
    },
    dismissCredentials() {
      this.setData({ credentials: null });
    },
    async create() {
      if (
        await this.action(async ({ user }) => {
          const form = this.data.form;
          if (!form.username.trim() || !form.displayName.trim())
            throw new Error("请填写登录账号和成员姓名");
          const payload = {
            username: form.username.trim(),
            displayName: form.displayName.trim(),
            phone: form.phone.trim(),
            role:
              permissions.isAdmin(user) && this.data.roleIndex === 1
                ? "leader"
                : "creator",
          };
          const leader = this.data.leaders[this.data.leaderIndex];
          if (permissions.isAdmin(user) && payload.role === "creator" && leader)
            payload.parentId = String(leader.id);
          const result = await request.post("/core/team/members", payload);
          if (this.canAct())
            this.setData({
              credentials: {
                username: result.username,
                password: result.temporaryPassword,
              },
              formOpen: false,
              form: { username: "", displayName: "", phone: "" },
            });
        }, "成员已创建，并自动开通可用项目")
      )
        await this.load();
    },
    manage(e) {
      if (this.data.busy || this.data.loading || !this.canAct()) return;
      const member = this.data.members[e.currentTarget.dataset.index];
      if (!member || !member.canManage) return;
      this.setData({
        selected: Object.assign({}, member, {
          self: String(member.id) === String(this.data.user.id),
        }),
        projectSelection: this.data.projects.map(p=>({...p,checked:(member.projects||[]).some(x=>String(x.id)===String(p.id))})),
        editName: member.displayName || "",
        editPhone: member.phone || "",
        resetPassword: "",
        error: "",
      });
    },
    closeManage() {
      if (!this.data.busy) this.setData({ selected: null, resetPassword: "" });
    },
    projectChange(e) { const values=e.detail.value; this.setData({projectSelection:this.data.projectSelection.map(p=>({...p,checked:values.includes(String(p.id))}))}); },
    async saveMember() {
      const member = this.data.selected;
      if (!member) return;
      if (
        await this.action(async () => {
          const displayName = this.data.editName.trim();
          if (!displayName) throw new Error("请填写成员姓名");
          await request.patch("/core/team/members/" + member.id + "/access", {
            displayName,
            phone: this.data.editPhone.trim(),
            ...(member.canAssignProjects ? {projectIds:[...new Set([...(member.projects||[]).filter(p=>!this.data.projects.some(x=>String(x.id)===String(p.id))).map(p=>String(p.id)),...this.data.projectSelection.filter(p=>p.checked).map(p=>String(p.id))])]} : {}),
          });
        }, "成员资料已更新")
      ) {
        this.setData({ selected: null });
        await this.load();
      }
    },
    async resetMemberPassword() {
      const member = this.data.selected;
      if (!member) return;
      if (
        await this.action(async () => {
          const password = this.data.resetPassword.trim();
          if (password && password.length < 8) throw new Error("密码至少 8 位");
          // 不填新密码时由服务端生成一次性临时密码，成员下次登录必须修改。
          const result = await request.post(
            "/core/team/members/" + member.id + "/reset-password",
            password ? { password } : {},
          );
          if (this.canAct() && result && result.temporaryPassword)
            this.setData({
              credentials: {
                username: member.username,
                password: result.temporaryPassword,
              },
              selected: null,
              resetPassword: "",
            });
        }, "密码已重置；请把新凭据交给成员")
      )
        await this.load();
    },
    async disableMember() {
      const member = this.data.selected;
      if (!member) return;
      const confirmed = await feedback.confirm(this, {
        title: "停用账号",
        message: "停用后该成员无法登录，当前会话立即失效。稍后可再次操作以恢复。",
        confirmText: "停用",
        danger: true,
      });
      if (!confirmed) return;
      if (
        await this.action(async () => {
          await request.post(
            "/core/team/members/" + member.id + "/disable",
            {},
          );
        }, "账号已停用")
      ) {
        this.setData({ selected: null });
        await this.load();
      }
    },
    async deleteMember() {
      const member = this.data.selected;
      if (!member) return;
      const confirmed = await feedback.confirm(this, {
        title: "删除成员",
        message:
          "仅在成员没有任何关联业务记录时可删除；有关联记录时服务端会拒绝，请改用停用。",
        confirmText: "删除",
        danger: true,
      });
      if (!confirmed) return;
      if (
        await this.action(async () => {
          await actions.del(this, "/core/team/members/" + member.id, {});
        }, "成员已删除")
      ) {
        this.setData({ selected: null });
        await this.load();
      }
    },
    async reviewApplication(e) {
      const item = this.data.applications[e.currentTarget.dataset.index],
        action = e.currentTarget.dataset.action;
      if (!item || !["approve", "reject"].includes(action)) return;
      if (
        await this.action(async () => {
          await request.post("/core/team/applications/" + item.id + "/review", {
            action,
          });
        }, "入团申请已处理")
      )
        await this.load();
    },
  }),
);
