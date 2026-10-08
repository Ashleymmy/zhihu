const {publicUrl} = require("./actions");
const permissions = require("./permissions");
const same = (a, b) => a != null && b != null && String(a) === String(b);
const labels = {
  novel: "编辑小说资料",
  claim: "领取",
  distribute: "分发",
  assign: "分配执行人",
  work: "登记作品",
  "request-release": "申请释放",
  release: "批准释放",
  stop: "停止新增使用",
  "retry-upstream": "重试上游",
  "edit-retry": "编辑并重试",
  "copy-retry": "沿用信息新建",
  delete: "删除错误记录",
};
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function flags(user, item) {
  if (!permissions.canOperate(user)) return [];
  const corrections = [];
  if (Number(item.canEditNovel) === 1) corrections.push("novel");
  if (Number(item.canEditFailed) === 1) corrections.push("edit-retry");
  if (Number(item.canCopyFailed) === 1) corrections.push("copy-retry");
  if (Number(item.canDeleteFailed) === 1) corrections.push("delete");
  if (Number(item.readOnly) === 1) return corrections;
  const admin = permissions.isAdmin(user);
  const owner =
    admin || same(item.leaderId, user.id) || same(item.executorId, user.id);
  const available = Number(item.allocationReady) === 1 && !Number(item.hasUsageHistory) &&
    !item.bindingId &&
    item.lifecycleStatus === "available" &&
    (item.syncStatus === "synced" || item.syncStatus === "simulated") &&
    item.planStatus === "active";
  const live = item.bindingId && item.lifecycleStatus !== "retired";
  const result = corrections;
  if (
    available &&
    (user.role === "leader" ||
      (user.role === "creator" &&
        !item.hasTeamLeader &&
        Number(item.priorityEnded) === 1))
  )
    result.push("claim");
  if (available && admin) result.push("distribute");
  if (
    live && Number(item.usageReady) === 1 &&
    !item.usedEverAt && !Number(item.hasUsageHistory) &&
    item.leaderId &&
    (admin || (user.role === "leader" && same(item.leaderId, user.id)))
  )
    result.push("assign");
  if (
    live && Number(item.usageReady) === 1 && item.executorId &&
    (admin || same(item.executorId, user.id)) &&
    item.releaseStatus !== "requested"
  )
    result.push("work");
  if (
    item.bindingId &&
    owner &&
    !item.usedEverAt && !Number(item.hasUsageHistory) &&
    item.releaseStatus !== "requested"
  )
    result.push("request-release");
  if (
    item.bindingId &&
    admin &&
    !item.usedEverAt && !Number(item.hasUsageHistory) &&
    item.releaseStatus === "requested"
  )
    result.push("release");
  if (live && owner) result.push("stop");
  if (admin && item.syncStatus === "failed" && !item.usedEverAt && !item.canEditFailed && !item.canDeleteFailed)
    result.push("retry-upstream");
  return result;
}
function targets(user, item, action, users) {
  if (action === "assign")
    return users.filter(
      (u) =>
        (same(u.id, item.leaderId) && u.role === "leader") ||
        (u.role === "creator" && same(u.parentId, item.leaderId)),
    );
  if (action === "distribute")
    return users.filter(
      (u) =>
        u.role === "leader" ||
        (u.role === "creator" &&
          (!u.parentId ||
            users.some((p) => same(p.id, u.parentId) && p.role === "leader"))),
    );
  return [];
}
function decorate(user, item, options) {
  item = Object.assign({},item,{hasTeamLeader:options.hasTeamLeader});
  const states = {
    available: "可领取",
    reserved: "团长已领取",
    assigned: "已分配",
    active: "已使用",
    retired: "已停止新增使用",
  };
  // pending 时"是否已提交知乎"和"知乎有没有审核"是两件独立的事，
  // 统一叫"等待同步"会让人误以为是数据没传过去，按 syncStatus 拆开说清楚。
  const pendingStates = {
    syncing: "正在提交知乎，暂不可使用",
    local: "待提交知乎，暂不可使用",
    failed: "知乎创建失败，禁止使用",
    synced: "创建记录待核对，暂不可使用",
  };
  const member = options.users.find((u) => same(u.id, item.executorId));
  const task = options.tasks.find((t) => same(t.id, item.taskId));
  return Object.assign({}, item, {
    novelLink: publicUrl(item.novelUrl || item.landingUrl || "") ? (item.novelUrl || item.landingUrl) : "",
    statusText:
      item.syncStatus === "failed" ? pendingStates.failed
      : Number(item.ownershipConflict) ? "归属待核对，禁止新增使用"
      : ["local","syncing"].includes(item.syncStatus) ? pendingStates[item.syncStatus]
      : item.lifecycleStatus === "historical" ? "已有历史记录，保留原归属"
      : item.planStatus === "paused" || item.planStatus === "rejected" || item.planStatus === "ended" ? "计划不可用"
      : item.lifecycleStatus === "available" && Number(item.allocationReady) !== 1 ? "暂不可领取"
      : item.lifecycleStatus === "pending"
        ? pendingStates[item.syncStatus] || "等待处理"
        : item.lifecycleStatus === "available" && user.role === "creator"
          ? options.hasTeamLeader
            ? "等待团长分配"
            : Number(item.priorityEnded) !== 1
              ? "优先期内，暂不可领取"
              : "可领取"
          : states[item.lifecycleStatus] || item.lifecycleStatus,
    taskName: item.taskName || (task ? task.name : "任务 " + item.taskId),
    executorName: member
      ? member.displayName
      : same(item.executorId, user.id)
        ? "本人"
        : item.executorId
          ? "成员 " + item.executorId
          : item.lifecycleStatus === "historical" ? item.ownerName || "保留原归属" : "待分配",
    actions: flags(user, item).map((key) => ({ key, label: labels[key] })),
  });
}
module.exports = { flags, targets, decorate, labels };
