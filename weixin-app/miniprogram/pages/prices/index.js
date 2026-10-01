const permissions = require("../../utils/permissions");
const screen = require("../../utils/screen");
const request = require("../../utils/request");
const actions = require("../../utils/actions");
const feedback = require("../../utils/feedback");

const ROLE_LABEL = { creator: "达人", leader: "团长" };
Page(
  screen("prices", {
    data: {
      list: [],
      roleList: [],
      memberList: [],
      tasks: [],
      payees: [],
      users: [],
      taskIndex: -1,
      payeeIndex: -1,
      formOpen: false,
      form: { unitPrice: "", from: actions.today(), to: "", reason: "" },
      rewardAmount: "",
      rewardOpen: false,
      rewardInput: "",
    },
    async fetch({ user, scope }) {
      const [options, result, reward] = await Promise.all([
        request.get("/modules/zhihu/attribution-options", scope),
        request.get(
          "/modules/zhihu/price-agreements",
          Object.assign({}, scope, { page: this.data.page, pageSize: 20 }),
        ),
        Promise.resolve(null),
      ]);
      const name = (list, id, field) => {
        const found = list.find((x) => String(x.id) === String(id));
        return found ? found[field] : String(id);
      };
      // 收款对象：先是角色分组（全局统一价），再是成员（个人价，带角色后缀）
      const groups = [];
      const members = options.users
        .filter((u) =>
          permissions.isAdmin(user)
            ? u.role === "leader" || (u.role === "creator" && !u.parentId)
            : u.role === "creator" && String(u.parentId) === String(user.id),
        )
        .map((u) =>
          Object.assign({}, u, {
            displayName: u.displayName + "（" + (ROLE_LABEL[u.role] || "成员") + "）",
          }),
        );
      const decorate = (item) =>
        Object.assign({}, item, {
          taskName: name(options.tasks, item.taskId, "name"),
          payeeName: String(item.payeeId).startsWith("role:")
            ? "全部" + ROLE_LABEL[item.payeeRole || item.payeeId.slice(5)] + "（全局）"
            : name(options.users, item.payeeId, "displayName"),
          isGroup: String(item.payeeId).startsWith("role:"),
          canPublish:
            item.priceStatus === "draft" &&
            (item.payerKind === "agency"
              ? permissions.isAdmin(user)
              : String(item.payerId) === String(user.id)),
        });
      const list = result.list.map(decorate);
      return {
        tasks: options.tasks,
        users: options.users,
        payees: groups.concat(members),
        total: result.total,
        list,
        roleList: list.filter((i) => i.isGroup),
        memberList: list.filter((i) => !i.isGroup),
        rewardAmount: reward && reward.amount ? Number(reward.amount).toFixed(2) : "",
      };
    },
    toggleForm() {
      if (this.canAct() && !this.data.busy)
        this.setData({ formOpen: !this.data.formOpen, error: "" });
    },
    // 全局价快捷入口：预填收款对象并展开表单
    setGroupPrice(e) {
      if (!this.canAct() || this.data.busy) return;
      const role = e.currentTarget.dataset.role;
      const index = this.data.payees.findIndex((p) => p.payeeRole === role);
      if (index < 0) return;
      this.setData({ formOpen: true, payeeIndex: index, error: "" });
    },
    chooseTask(e) {
      this.setData({ taskIndex: Number(e.detail.value) });
    },
    choosePayee(e) {
      this.setData({ payeeIndex: Number(e.detail.value) });
    },
    toggleReward() {
      this.setData({
        rewardOpen: !this.data.rewardOpen,
        rewardInput: this.data.rewardAmount,
        error: "",
      });
    },
    async saveReward() {
      const amount = this.data.rewardInput.trim();
      if (
        await this.action(async () => {
          if (!actions.money(amount, 4)) throw new Error("金额须大于零，最多四位小数");
          await actions.post(this, "/core/settings/invite-reward", { amount });
        }, "邀请返利已更新")
      ) {
        this.setData({ rewardOpen: false });
        await this.load();
      }
    },
    async create() {
      if (
        await this.action(async ({ scope }) => {
          const task = this.data.tasks[this.data.taskIndex],
            payee = this.data.payees[this.data.payeeIndex],
            form = this.data.form;
          if (
            !task ||
            !payee ||
            !actions.money(form.unitPrice, 4, true) ||
            !form.reason.trim() ||
            !form.from ||
            (form.to && form.to <= form.from)
          )
            throw new Error(
              "请选择任务和收款对象，金额最多四位小数，填写原因与有效日期",
            );
          const payload = Object.assign({}, scope, {
            taskId: String(task.id),
            unitPrice: form.unitPrice,
            from: form.from,
            to: form.to || undefined,
            reason: form.reason.trim(),
          });
          if (payee.payeeRole) payload.payeeRole = payee.payeeRole;
          else payload.payeeId = String(payee.id);
          await actions.post(this, "/modules/zhihu/price-agreements", payload);
        }, "定价草稿已保存，请核对后发布")
      ) {
        this.setData({ formOpen: false });
        await this.load();
      }
    },
    async publish(e) {
      // 列表分「全局/个人」两段渲染，用 versionId 定位，避免分段索引错位
      const item = this.data.list.find(
        (x) => String(x.versionId) === String(e.currentTarget.dataset.id),
      );
      if (!item || !item.canPublish || !this.canAct()) return;
      const confirmed = await feedback.confirm(this, {
        title: "发布单价",
        message:
          item.payeeName +
          " · 每单 ¥" +
          item.price +
          "，从 " +
          item.startDay +
          " 起生效。",
        confirmText: "确认发布",
      });
      if (!confirmed) return;
      if (
        await this.action(async ({ scope }) => {
          await actions.post(
            this,
            "/modules/zhihu/price-versions/" + item.versionId + "/publish",
            scope,
          );
        }, "单价已发布")
      )
        await this.load();
    },
  }),
);
