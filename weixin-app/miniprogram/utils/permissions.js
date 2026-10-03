const nav = require("./nav");
function isAdmin(user) {
  return !!user && ["developer", "admin", "operator"].includes(user.role);
}
function known(user) {
  return !!user && ["developer", "admin", "operator", "leader", "creator"].includes(user.role);
}
function duty(user, name) {
  return isAdmin(user) && (user.role !== "operator" || name === "operations") && ["all", name].includes(user.adminDuty || "all");
}
function canOperate(user) {
  return known(user) && (!isAdmin(user) || duty(user, "operations"));
}
function canFinance(user) {
  return known(user) && (!isAdmin(user) || duty(user, "finance"));
}
function allowed(user, page) {
  if (!known(user)) return false;
  if (
    ["home", "mine", "profile", "password", "college", "tools", "income", "zhihu", "work-data", "work-detail", "works"].includes(
      page,
    )
  )
    return true;
  if (page === "invite") return canOperate(user);
  if (["keywords", "keywords-create"].includes(page)) return canOperate(user);
  if (["wallet", "withdrawals"].includes(page)) return canFinance(user);
  if (page === "reports") return duty(user, "finance");
  if (page === "projects") return ["admin","developer"].includes(user.role) && duty(user,"operations");
  if (page === "admin") return duty(user,"operations");
  if (["team", "prices"].includes(page))
    return user.role === "leader" || duty(user, "operations");
  return false;
}
function menus(user) {
  const labels = {
    keywords: isAdmin(user) ? "关键词管理" : "我的关键词",
    works: "作品记录",
    wallet: isAdmin(user) ? "财务账单" : "收入与提现",
    reports: "报表与异常",
    team: "团队成员",
    prices: "定价规则",
    admin: "运营管理",
  };
  return Object.keys(labels)
    .filter((key) => allowed(user, key))
    .map((key) => ({
      key,
      label: labels[key],
      path: "/pages/" + key + "/index",
    }))
    .filter((item) => !nav.isTab(item.path) && !nav.isZhihuHub(item.path));
}
function roleLabel(user) {
  if (!known(user)) return "无权限";
  if (user.role === "developer") return "开发者";
  if (user.role === "operator") return "运营管理员";
  if (isAdmin(user))
    return user.adminDuty === "finance"
      ? "财务管理员"
      : user.adminDuty === "operations"
        ? "运营管理员"
        : "管理员";
  return user.role === "leader" ? "团长" : "达人";
}
module.exports = { isAdmin, canOperate, canFinance, allowed, menus, roleLabel };
