const screen = require("../../utils/screen");
const request = require("../../utils/request");
const scopes = require("../../utils/scope");
Page(
  screen("projects", {
    scoped: false,
    data: {
      projects: [],
      projectIndex: 0,
      members: [],
      users: [],
      integrations: [],
      accounts: [],
      userIndex: -1,
      accountIndex: -1,
      roleIndex: 2,
      roles: ["所有者", "项目管理员", "成员", "只读成员"],
      formOpen: false,
      form: { name: "", slug: "" },
      selectedProject: null,
    },
    async fetch() {
      const [projects, users, allAccounts] = await Promise.all([
        request.get("/core/projects"),
        request.get("/core/team/members"),
        request.get("/core/integrations"),
      ]);
      const projectIndex = Math.max(
        0,
        projects.findIndex(
          (p) =>
            String(p.id) ===
            String(this._projectId || getApp().globalData.scope.projectId),
        ),
      );
      const project = projects[projectIndex];
      const [members, integrations] = project
        ? await Promise.all([
            request.get("/core/projects/" + project.id + "/members"),
            request.get("/core/projects/" + project.id + "/integrations"),
          ])
        : [[], []];
      const roleLabels = {
        owner: "所有者",
        admin: "项目管理员",
        member: "成员",
        viewer: "只读成员",
      };
      return {
        projects,
        projectIndex,
        selectedProject: project || null,
        members: members.map((m) =>
          Object.assign({}, m, { roleText: roleLabels[m.memberRole] }),
        ),
        integrations,
        users: users.filter(
          (u) =>
            u.isActive &&
            !members.some((m) => String(m.userId) === String(u.id)),
        ),
        accounts: allAccounts.filter(
          (a) =>
            a.moduleId === "zhihu" &&
            a.status === "active" &&
            !integrations.some((i) => String(i.id) === String(a.id)),
        ),
        userIndex: -1,
        accountIndex: -1,
      };
    },
    chooseProject(e) {
      if (this.data.busy || this.data.loading) return;
      const p = this.data.projects[Number(e.detail.value)];
      if (p) {
        this._projectId = p.id;
        this.setData({ selectedProject: null, members: [], integrations: [] });
        this.load();
      }
    },
    chooseUser(e) {
      this.setData({ userIndex: Number(e.detail.value) });
    },
    chooseAccount(e) {
      this.setData({ accountIndex: Number(e.detail.value) });
    },
    chooseRole(e) {
      this.setData({ roleIndex: Number(e.detail.value) });
    },
    toggleForm() {
      if (this.canAct() && !this.data.busy)
        this.setData({ formOpen: !this.data.formOpen, error: "" });
    },
    async create() {
      if (
        await this.action(async () => {
          const { name, slug } = this.data.form;
          if (!name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()))
            throw new Error("请填写项目名称和小写字母、数字或短横线标识");
          const result = await request.post("/core/projects", {
            name: name.trim(),
            slug: slug.trim(),
          });
          this._projectId = result.id;
          scopes.reset();
          this.setData({ formOpen: false, form: { name: "", slug: "" } });
        }, "项目已创建，请关联接入账号并授权成员")
      )
        await this.load();
    },
    async grant() {
      if (
        await this.action(async () => {
          const project = this.data.selectedProject,
            user = this.data.users[this.data.userIndex];
          if (!project || !user || this.data.loading)
            throw new Error("请选择项目和成员");
          await request.post("/core/projects/" + project.id + "/members", {
            userId: String(user.id),
            memberRole: ["owner", "admin", "member", "viewer"][
              this.data.roleIndex
            ],
          });
        }, "项目成员权限已保存")
      )
        await this.load();
    },
    async linkAccount() {
      if (
        await this.action(async () => {
          const project = this.data.selectedProject,
            account = this.data.accounts[this.data.accountIndex];
          if (!project || !account || this.data.loading)
            throw new Error("请选择项目和接入账号");
          await request.post("/core/projects/" + project.id + "/integrations", {
            accountId: String(account.id),
          });
          scopes.reset();
        }, "知乎接入账号已关联，可返回工作台选择")
      )
        await this.load();
    },
  }),
);
