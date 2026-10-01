const request = require("./request");
const TOKEN_KEY = "zk_access_token";
const USER_KEY = "zk_user";
let revision = 0;
let pending = null;
function clear() {
  revision++;
  pending = null;
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
  wx.removeStorageSync("zk_scope");
  require("./scope").reset();
  const app = getApp();
  if (app) {
    app.globalData.user = null;
    app.globalData.scope = { projectId: "", accountId: "" };
  }
}
function store(user) {
  wx.setStorageSync(USER_KEY, user);
  getApp().globalData.user = user;
  return user;
}
async function login(username, password) {
  clear();
  const version = revision;
  const result = await request.send("/core/auth/login", {
    method: "POST",
    data: { username, password },
    auth: false,
  });
  if (version !== revision) throw new Error("登录已取消，请重试");
  wx.setStorageSync(TOKEN_KEY, result.token);
  return ensure();
}
async function loginWithWeChat() {
  clear();
  const version = revision;
  const result = await request.send("/core/auth/wechat-login", {
    method: "POST",
    data: {},
    auth: false,
  });
  if (version !== revision) throw new Error("登录已取消，请重试");
  // 当前微信未绑定账号：由小程序引导到绑定页（手机号 + 邀请码）
  if (result && result.needsBind) return { needsBind: true };
  wx.setStorageSync(TOKEN_KEY, result.token);
  return ensure();
}
async function register(phone, password, inviteCode, displayName) {
  clear();
  const version = revision;
  const result = await request.send("/core/auth/register", {
    method: "POST",
    data: { phone, password, inviteCode, displayName: displayName || "" },
    auth: false,
  });
  if (version !== revision) throw new Error("注册已取消，请重试");
  wx.setStorageSync(TOKEN_KEY, result.token);
  return ensure();
}
async function bindWechat(username, password) {
  clear();
  const version = revision;
  const result = await request.send("/core/auth/bind", {
    method: "POST",
    data: { username, password },
    auth: false,
  });
  if (version !== revision) throw new Error("绑定已取消，请重试");
  wx.setStorageSync(TOKEN_KEY, result.token);
  return ensure();
}
function ensure() {
  // onLaunch 期间 App 实例尚未注册，getApp() 会返回 undefined，此处与 clear() 同样容忍。
  const app = getApp();
  if (app && app.globalData.user)
    return Promise.resolve(app.globalData.user);
  if (!wx.getStorageSync(TOKEN_KEY)) return Promise.resolve(null);
  if (pending) return pending;
  const version = revision;
  const task = request
    .get("/core/auth/me")
    .then((user) => (version === revision ? store(user) : null));
  pending = task;
  task.then(
    () => {
      if (pending === task) pending = null;
    },
    () => {
      if (pending === task) pending = null;
    },
  );
  return task;
}
async function logout() {
  const ending = request.post("/core/auth/logout").catch(() => {});
  clear();
  await ending;
}
function entryPath(user) {
  if (user.mustChangePwd) return "/pages/password/index";
  return user.role === "admin" && user.adminDuty === "finance"
    ? "/pages/wallet/index"
    : "/pages/home/index";
}
module.exports = {
  TOKEN_KEY,
  USER_KEY,
  login,
  loginWithWeChat,
  register,
  bindWechat,
  restore: ensure,
  ensure,
  logout,
  clear,
  entryPath,
};
