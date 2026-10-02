const request = require("./request");
const invitation = require("./invitation");
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
  invitation.clear();
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
  // Only explicit binding enables WeChat quick login.
  if (result && result.needsBind) return { needsBind: true };
  wx.setStorageSync(TOKEN_KEY, result.token);
  return ensure();
}
async function loginWithSms(phone, smsCode) {
  clear();
  const version = revision;
  const result = await request.send("/core/auth/sms-login", {
    method: "POST",
    auth: false,
    data: { phone, smsCode },
  });
  if (version !== revision) throw new Error("登录已取消，请重试");
  wx.setStorageSync(TOKEN_KEY, result.token);
  return ensure();
}
async function verifyPhone(phone, password, smsCode) {
  const version = revision;
  const user = await request.post("/core/auth/verify-phone", {
    phone,
    password,
    smsCode,
  });
  if (version !== revision) throw new Error("登录已变化，请重新进入个人信息");
  return store(user);
}
async function register(phone, password, inviteCode, displayName, smsCode) {
  clear();
  const version = revision;
  const result = await request.send("/core/auth/register", {
    method: "POST",
    data: {
      phone,
      password,
      ...(inviteCode ? { inviteCode } : {}),
      displayName: displayName || "",
      ...(smsCode ? { smsCode } : {}),
    },
    auth: false,
  });
  if (version !== revision) throw new Error("注册已取消，请重试");
  wx.setStorageSync(TOKEN_KEY, result.token);
  return ensure();
}
async function bindWechat(
  username,
  password,
  phone,
  smsCode,
  authenticated = false,
) {
  if (!authenticated) clear();
  const version = revision;
  const result = await request.send(
    authenticated ? "/core/auth/bind-current" : "/core/auth/bind",
    {
      method: "POST",
      data: {
        ...(authenticated ? {} : { username }),
        password,
        phone,
        smsCode,
      },
      auth: authenticated,
    },
  );
  if (version !== revision) throw new Error("绑定已取消，请重试");
  if (authenticated) return store(result);
  wx.setStorageSync(TOKEN_KEY, result.token);
  return ensure();
}
function ensure() {
  // onLaunch 期间 App 实例尚未注册，getApp() 会返回 undefined，此处与 clear() 同样容忍。
  const app = getApp();
  if (app && app.globalData.user) return Promise.resolve(app.globalData.user);
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
  bindingStatus: () => request.get("/core/auth/binding-status"),
  sendBindingCode: (username, password, phone, authenticated = false) =>
    request.send(
      authenticated ? "/core/auth/bind-current-code" : "/core/auth/bind-code",
      {
        method: "POST",
        auth: authenticated,
        data: { ...(authenticated ? {} : { username }), password, phone },
      },
    ),
  smsPolicy: () => request.send("/core/auth/sms-policy", { auth: false }),
  sendLoginCode: (phone) =>
    request.send("/core/auth/login-code", {
      method: "POST",
      auth: false,
      data: { phone },
    }),
  sendPhoneCode: (phone, password) =>
    request.post("/core/auth/phone-code", { phone, password }),
  loginWithSms,
  verifyPhone,
  registrationPolicy: (inviteCode) =>
    request.send("/core/auth/registration-policy", {
      auth: false,
      data: inviteCode ? { inviteCode } : {},
    }),
  sendRegistrationCode: (phone, inviteCode) =>
    request.send("/core/auth/registration-code", {
      method: "POST",
      auth: false,
      data: { phone, ...(inviteCode ? { inviteCode } : {}) },
    }),
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
