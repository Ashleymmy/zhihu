const test = require("node:test"),
  assert = require("node:assert/strict");
const { harness } = require("./harness.cjs");
const fs = require("node:fs"),
  path = require("node:path");
const user = {
  id: "100",
  username: "legacy",
  role: "creator",
  phone: "13800000001",
};
function setup() {
  return harness((c) => {
    if (
      c.path === "/core/auth/me" ||
      c.path === "/core/auth/profile" ||
      c.path === "/core/auth/bind-current"
    )
      return user;
    if (c.path === "/core/auth/wechat-login") return { needsBind: true };
    if (c.path === "/core/auth/sms-policy") return { smsLoginEnabled: true };
    if (c.path === "/core/auth/binding-status")
      return { bound: false, currentWechat: false };
    if (c.path === "/core/auth/registration-policy")
      return { smsRequired: true, smsEnabled: true };
    if (c.path.endsWith("-code")) return { retryAfterSeconds: 60 };
    return { token: "fixture" };
  });
}
const fields = {
  phone: user.phone,
  username: user.username,
  password: "Test_password123",
  smsCode: "123456",
  ready: true,
  policyReady: true,
};
for (const name of ["login", "register", "bind", "phone-verify"])
  test(
    name + " consent cancel sends nothing; confirm unlocks without submitting",
    async () => {
      const h = setup(),
        p = h.page(name);
      p.setData({ ...fields, enabled: true, loading: false });
      await p.submit();
      assert.equal(p.data.consentOpen, true);
      assert.equal(h.calls.length, 0);
      p.cancelConsent();
      assert.equal(p.data.agreed, false);
      assert.equal(p.data.consentOpen, false);
      await p.submit();
      p.confirmConsent();
      assert.equal(p.data.agreed, true);
      assert.equal(h.calls.length, 0);
      p.toggleAgree();
      assert.equal(p.data.agreed, false);
      p.openAgreement({ currentTarget: { dataset: { type: "privacy" } } });
      assert.ok(h.navigation.includes("/pages/agreement/index?type=privacy"));
    },
  );
test("password and WeChat login both enforce consent; unbound quick login opens binding page", async () => {
  const h = setup(),
    p = h.page("login");
  await p.onLoad();
  p.setData(fields);
  await p.wechatLogin();
  assert.equal(p.data.consentOpen, true);
  assert.ok(!h.calls.some((c) => c.path.endsWith("/wechat-login")));
  p.confirmConsent();
  await p.wechatLogin();
  assert.ok(h.navigation.includes("/pages/bind/index"));
});
test("password is default and a single toggle switches back and clears secrets", async () => {
  const h = setup(),
    p = h.page("login");
  await p.onLoad();
  assert.equal(p.data.mode, "password");
  p.setData({ password: "secret" });
  p.toggleMode();
  assert.equal(p.data.mode, "sms");
  assert.equal(p.data.password, "");
  p.setData({ smsCode: "123456" });
  p.toggleMode();
  assert.equal(p.data.mode, "password");
  assert.equal(p.data.smsCode, "");
});
test("registration validates phone, password and mandatory SMS without requiring invite", async () => {
  const h = setup(),
    p = h.page("register");
  await p.onLoad();
  p.setData({ ...fields, agreed: true, phone: "123" });
  await p.submit();
  assert.match(p.data.error, /11 位/);
  p.setData({ phone: user.phone, password: "short" });
  await p.submit();
  assert.match(p.data.error, /至少 8/);
  p.setData({ password: fields.password, smsCode: "" });
  await p.submit();
  assert.match(p.data.error, /6 位/);
  assert.ok(!h.calls.some((c) => c.path.endsWith("/register")));
  p.setData({ smsCode: "123456" });
  await p.submit();
  const sent = h.calls.find((c) => c.path.endsWith("/register"));
  assert.equal(sent.data.inviteCode, undefined);
  assert.equal(sent.data.smsCode, "123456");
  assert.ok(h.navigation.includes("/pages/home/index"));
});
test("public binding needs password and fresh phone code and submits only binding fields", async () => {
  const h = setup(),
    p = h.page("bind");
  await p.onLoad();
  p.setData({ ...fields, agreed: true, smsCode: "" });
  await p.submit();
  assert.match(p.data.error, /6 位/);
  assert.ok(!h.calls.some((c) => c.path.endsWith("/bind")));
  await p.sendCode();
  assert.equal(p.data.cooldown, 60);
  p.setData({ smsCode: "123456" });
  await p.submit();
  const sent = h.calls.find((c) => c.path.endsWith("/bind"));
  assert.deepEqual(JSON.parse(JSON.stringify(sent.data)), {
    username: fields.username,
    password: fields.password,
    phone: fields.phone,
    smsCode: "123456",
  });
  assert.ok(h.navigation.includes("/pages/home/index"));
  p.onUnload();
});
test("profile binding keeps account identity and existing session token", async () => {
  const h = setup();
  h.session(user);
  const p = h.page("bind");
  await p.onLoad({ from: "profile" });
  assert.equal(p.data.username, user.username);
  p.input({
    currentTarget: { dataset: { name: "username" } },
    detail: { value: "victim" },
  });
  assert.equal(p.data.username, user.username);
  p.setData({ password: fields.password, smsCode: "123456", agreed: true });
  await p.submit();
  const sent = h.calls.find((c) => c.path.endsWith("/bind-current"));
  assert.equal(sent.data.username, undefined);
  assert.equal(sent.header.Authorization, "Bearer test-token");
  assert.equal(h.storage.get("zk_access_token"), "test-token");
  assert.ok(h.navigation.includes("/pages/profile/index"));
});
test("profile offers explicit social binding without an invitation-code form", async () => {
  const h = setup();
  h.session(user);
  const p = h.page("profile");
  await p.onShow();
  p.openSocialBinding();
  assert.ok(h.navigation.includes("/pages/bind/index?from=profile"));
  const source = fs.readFileSync(
    path.join(__dirname, "../miniprogram/pages/profile/index.wxml"),
    "utf8",
  );
  assert.match(source, /社交账号绑定/);
  assert.doesNotMatch(source, /填写邀请码|showInviteModal/);
});
test("all primary auth actions have visual consent state and clickable agreement explanation", () => {
  for (const name of ["login", "register", "bind", "phone-verify"]) {
    const source = fs.readFileSync(
      path.join(__dirname, "../miniprogram/pages/" + name + "/index.wxml"),
      "utf8",
    );
    assert.match(source, /templates\/consent.wxml/);
    assert.match(source, /consent-locked/);
    assert.doesNotMatch(source, /\sdisabled="\{\{[^"]*!agreed/);
  }
  const consent = fs.readFileSync(
    path.join(__dirname, "../miniprogram/templates/consent.wxml"),
    "utf8",
  );
  assert.match(consent, /我已确认并阅读/);
  assert.match(consent, /取消/);
});
