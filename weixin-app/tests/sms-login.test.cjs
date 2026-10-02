const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, deferred } = require("./harness.cjs");
const user = {
  id: "8",
  role: "creator",
  phone: "13800001234",
  phoneVerifiedAt: null,
};
function setup(overrides = {}) {
  return harness((call) => {
    if (overrides[call.path]) return overrides[call.path](call);
    if (call.path === "/core/auth/sms-policy") return { smsLoginEnabled: true };
    if (
      call.path === "/core/auth/login-code" ||
      call.path === "/core/auth/phone-code"
    )
      return { retryAfterSeconds: 60, expiresInSeconds: 300 };
    if (
      call.path === "/core/auth/sms-login" ||
      call.path === "/core/auth/login"
    )
      return { token: "sms_login_fixture_token" };
    if (call.path === "/core/auth/verify-phone")
      return { ...user, phoneVerifiedAt: "2026-10-02T00:00:00Z" };
    if (call.path === "/core/auth/me" || call.path === "/core/auth/profile")
      return user;
    return {};
  });
}
const mode = (p) => p.setMode({ currentTarget: { dataset: { mode: "sms" } } });
const fields = { phone: user.phone, smsCode: "123456", agreed: true };
test("SMS mode follows server policy, validates consent and submits no password or invitation", async () => {
  const h = setup(),
    p = h.page("login");
  await p.onLoad();
  mode(p);
  p.setData({ ...fields, agreed: false });
  await p.submit();
  assert.equal(p.data.consentOpen, true);
  assert.equal(h.calls.filter((c) => c.path.endsWith("/sms-login")).length, 0);
  p.setData({ agreed: true, smsCode: "123" });
  await p.submit();
  assert.match(p.data.error, /6 位/);
  p.setData({ smsCode: "123456" });
  await p.submit();
  const call = h.calls.find((c) => c.path.endsWith("/sms-login"));
  assert.deepEqual(JSON.parse(JSON.stringify(call.data)), {
    phone: user.phone,
    smsCode: "123456",
  });
  assert.ok(h.navigation.includes("/pages/home/index"));
  assert.equal(p.data.smsCode, "");
});
test("disabled or failed policy retains password login without SMS requests", async () => {
  for (const policy of [
    { smsLoginEnabled: false },
    { http: 503, body: { code: 50320, message: "暂不可用" } },
  ]) {
    const h = setup({ "/core/auth/sms-policy": () => policy }),
      p = h.page("login");
    await p.onLoad();
    mode(p);
    assert.equal(p.data.mode, "password");
    p.setData({ username: "legacy", password: "fixture", agreed: true });
    await p.submit();
    assert.ok(h.calls.some((c) => c.path.endsWith("/login")));
    assert.ok(!h.calls.some((c) => c.path.endsWith("/sms-login")));
  }
});
test("duplicate sends are blocked, cooldown survives hide/show, phone edits clear code", async () => {
  const send = deferred(),
    h = setup({ "/core/auth/login-code": () => send.promise }),
    p = h.page("login");
  await p.onLoad();
  mode(p);
  p.setData(fields);
  const pending = p.sendCode();
  await p.sendCode();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.filter((c) => c.path.endsWith("/login-code")).length, 1);
  send.resolve({ retryAfterSeconds: 60 });
  await pending;
  assert.equal(p.data.cooldown, 60);
  p.onHide();
  p.onShow();
  assert.ok(p.data.cooldown > 0);
  await p.sendCode();
  assert.equal(h.calls.filter((c) => c.path.endsWith("/login-code")).length, 1);
  p.input({
    currentTarget: { dataset: { name: "phone" } },
    detail: { value: "13800009999" },
  });
  assert.equal(p.data.smsCode, "");
  assert.equal(p.data.codeNotice, "");
  p.onUnload();
  assert.equal(p._smsTimer, null);
});
test("provider failure and rejected OTP never show success or navigate", async () => {
  const failure = () => ({
    http: 422,
    body: { code: 42220, message: "验证码错误" },
  });
  const h = setup({
      "/core/auth/login-code": failure,
      "/core/auth/sms-login": failure,
    }),
    p = h.page("login");
  await p.onLoad();
  mode(p);
  p.setData(fields);
  await p.sendCode();
  assert.equal(p.data.cooldown, 0);
  assert.equal(p.data.codeNotice, "");
  p.setData({ smsCode: "123456" });
  await p.submit();
  assert.equal(p.data.busy, false);
  assert.match(p.data.error, /验证码/);
  assert.equal(h.navigation.length, 0);
});
test("late SMS login cannot restore a cleared or replaced session", async () => {
  const response = deferred(),
    h = setup({ "/core/auth/sms-login": () => response.promise }),
    auth = h.load("utils/auth");
  const pending = auth.loginWithSms(user.phone, "123456");
  await new Promise((r) => setImmediate(r));
  auth.clear();
  response.resolve({ token: "stale_token" });
  await assert.rejects(pending, /取消/);
  assert.equal(h.storage.get("zk_access_token"), undefined);
});
test("phone verification requires login, current password and explicit consent", async () => {
  const guest = setup(),
    page = guest.page("phone-verify");
  await page.onLoad();
  assert.ok(guest.navigation.includes("/pages/login/index"));
  const h = setup();
  h.session(user);
  const p = h.page("phone-verify");
  await p.onLoad();
  assert.equal(p.data.registeredPhone, true);
  assert.equal(p.data.phone, user.phone);
  p.setData({ agreed: true });
  await p.sendCode();
  assert.match(p.data.error, /密码/);
  p.setData({ password: "fixture", agreed: false });
  await p.sendCode();
  assert.equal(p.data.consentOpen, true);
  assert.equal(h.calls.filter((c) => c.path.endsWith("/phone-code")).length, 0);
  p.input({
    currentTarget: { dataset: { name: "phone" } },
    detail: { value: "13800009999" },
  });
  assert.equal(p.data.phone, user.phone);
});
test("phone verification refreshes cached account and clears secrets after success", async () => {
  const h = setup();
  h.session(user);
  const p = h.page("phone-verify");
  await p.onLoad();
  p.setData({ password: "fixture", agreed: true });
  await p.sendCode();
  p.setData({ smsCode: "123456" });
  await p.submit();
  assert.equal(p.data.verified, true);
  assert.equal(p.data.password, "");
  assert.equal(p.data.smsCode, "");
  assert.ok(h.app.globalData.user.phoneVerifiedAt);
  const sent = h.calls.find((c) => c.path.endsWith("/verify-phone"));
  assert.equal(sent.header.Authorization, "Bearer test-token");
  assert.equal(sent.data.password, "fixture");
  p.onUnload();
});
test("already verified or disabled accounts cannot submit phone verification", async () => {
  for (const overrides of [
    {
      "/core/auth/profile": () => ({ ...user, phoneVerifiedAt: "2026-10-02" }),
    },
    { "/core/auth/sms-policy": () => ({ smsLoginEnabled: false }) },
  ]) {
    const h = setup(overrides);
    h.session(user);
    const p = h.page("phone-verify");
    await p.onLoad();
    p.setData({ ...fields, password: "fixture" });
    await p.sendCode();
    await p.submit();
    assert.equal(
      h.calls.filter(
        (c) =>
          c.path.endsWith("/verify-phone") || c.path.endsWith("/phone-code"),
      ).length,
      0,
    );
  }
});
