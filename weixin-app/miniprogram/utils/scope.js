const request = require("./request");
let snapshot = null;
let pending = null;
let revision = 0;
const empty = () => ({ projectId: "", accountId: "" });
const same = (a, b) => String(a) === String(b);
function reset() {
  revision++;
  snapshot = null;
  pending = null;
  getApp().globalData.scope = empty();
}
function commit(view, userId) {
  snapshot = view;
  getApp().globalData.scope = Object.assign({}, view.scope);
  wx.setStorageSync("zk_scope", Object.assign({ userId }, view.scope));
  return view;
}
async function load(force = false, projectId, accountId) {
  const user = getApp().globalData.user;
  if (!user) return null;
  if (!force && snapshot && snapshot.scope.accountId && same(snapshot.userId, user.id)) return snapshot;
  if (!force && pending) return pending;
  const version = ++revision;
  const saved = wx.getStorageSync("zk_scope");
  const current = saved && same(saved.userId, user.id) ? saved : empty();
  getApp().globalData.scope = empty();
  snapshot = null;
  const task = (async () => {
    const projects = (await request.get("/core/projects")).filter(
      (p) => p.isEnabled !== false,
    );
    const projectIndex = Math.max(
      0,
      projects.findIndex((p) => same(p.id, projectId || current.projectId)),
    );
    const project = projects[projectIndex];
    const accounts = project
      ? (
          await request.get("/core/projects/" + project.id + "/integrations")
        ).filter((a) => a.moduleId === "zhihu" && a.status === "active")
      : [];
    const accountIndex = Math.max(
      0,
      accounts.findIndex((a) => same(a.id, accountId || current.accountId)),
    );
    const account = accounts[accountIndex];
    if (version !== revision || getApp().globalData.user !== user) return null;
    return commit(
      {
        userId: user.id,
        projects,
        accounts,
        projectIndex,
        accountIndex,
        scope: {
          projectId: project ? String(project.id) : "",
          accountId: account ? String(account.id) : "",
        },
        label: project
          ? project.name + (account ? " · " + account.name : "")
          : "",
        notice: !project
          ? "暂无可用项目，请联系运营人员授权。"
          : !account
            ? "此项目尚未关联可用的知乎接入账号。"
            : "",
      },
      user.id,
    );
  })();
  pending = task;
  try {
    return await task;
  } finally {
    if (pending === task) pending = null;
  }
}
function selectAccount(index) {
  if (!snapshot || !snapshot.accounts[index]) return null;
  const view = Object.assign({}, snapshot, {
    accountIndex: index,
    scope: Object.assign({}, snapshot.scope, {
      accountId: String(snapshot.accounts[index].id),
    }),
  });
  view.label =
    view.projects[view.projectIndex].name + " · " + view.accounts[index].name;
  return commit(view, view.userId);
}
module.exports = { ensure: load, load, reset, selectAccount };
