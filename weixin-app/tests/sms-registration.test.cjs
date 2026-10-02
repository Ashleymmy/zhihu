const test = require("node:test"),
  assert = require("node:assert/strict");
const { harness, deferred } = require("./harness.cjs");
const fields = { phone: "13900001234", password: "Sms_test_123", agreed: true };
function setup(overrides = {}) {
  return harness((c) => {
    if (overrides[c.path]) return overrides[c.path](c);
    if (c.path.endsWith("/registration-policy"))
      return { smsRequired: true, smsEnabled: true };
    if (c.path.endsWith("/registration-code"))
      return { retryAfterSeconds: 60, expiresInSeconds: 300 };
    if (c.path.endsWith("/register")) return { token: "fixture" };
    if (c.path.endsWith("/me"))
      return { id: "1", role: "creator", phoneVerifiedAt: "2026-10-02" };
    return {};
  });
}
test("share invitation is hidden, normalized and preserved through SMS registration", async () => {
  const h = setup(),
    p = h.page("register");
  await p.onLoad({ invite: "abcdefgh" });
  p.setData(fields);
  assert.equal(p.data.inviteCode, "ABCDEFGH");
  await p.submit();
  assert.match(p.data.error, /6 位/);
  p.setData({ smsCode: "123456" });
  await p.submit();
  const sent = h.calls.find((c) => c.path.endsWith("/register"));
  assert.equal(sent.data.inviteCode, "ABCDEFGH");
  assert.equal(sent.data.smsCode, "123456");
  assert.equal(h.load("utils/invitation").get(), "");
});
test("no invitation is allowed and no captcha service is requested", async () => {
  const h = setup(),
    p = h.page("register");
  await p.onLoad();
  p.setData(fields);
  await p.sendCode();
  const sent = h.calls.find((c) => c.path.endsWith("/registration-code"));
  assert.equal(sent.data.inviteCode, undefined);
  assert.equal(p.data.cooldown, 60);
  assert.ok(h.calls.every((c) => !/captcha/.test(c.path)));
  p.onUnload();
});
test("malformed and revoked invitations block rather than falling back to independent registration", async () => {
  const h = setup({
      "/core/auth/registration-policy": () => ({
        http: 422,
        body: { code: 42220, message: "邀请已失效" },
      }),
    }),
    p = h.page("register");
  await p.onLoad({ invite: "bad" });
  p.setData({ ...fields, smsCode: "123456" });
  assert.equal(p.data.inviteCode, "BAD");
  await p.submit();
  await p.sendCode();
  assert.equal(p.data.policyReady, false);
  assert.ok(!h.calls.some((c) => /\/register$|-code$/.test(c.path)));
});
test("network failure or old policy cannot bypass required SMS; retry recovers safely", async () => {
  let policy = { http: 503, body: { code: 50320, message: "稍后重试" } };
  const h = setup({ "/core/auth/registration-policy": () => policy }),
    p = h.page("register");
  await p.onLoad();
  p.setData({ ...fields, smsCode: "123456" });
  await p.submit();
  assert.equal(p.data.policyReady, false);
  policy = { smsRequired: false };
  await p.loadPolicy();
  assert.equal(p.data.policyReady, false);
  policy = { smsRequired: true, smsEnabled: true };
  await p.loadPolicy();
  await p.submit();
  assert.ok(h.calls.some((c) => c.path.endsWith("/register")));
});
test("consent gates sending, double taps send once and cooldown survives hide/show", async () => {
  const sending = deferred(),
    h = setup({ "/core/auth/registration-code": () => sending.promise }),
    p = h.page("register");
  await p.onLoad();
  p.setData({ ...fields, agreed: false });
  await p.sendCode();
  assert.equal(p.data.consentOpen, true);
  p.confirmConsent();
  const pending = p.sendCode();
  await p.sendCode();
  sending.resolve({ retryAfterSeconds: 60 });
  await pending;
  assert.equal(
    h.calls.filter((c) => c.path.endsWith("/registration-code")).length,
    1,
  );
  assert.equal(p.data.cooldown, 60);
  p.onHide();
  p.onShow();
  assert.ok(p.data.cooldown > 0);
  p._smsRetryAt = Date.now() - 1;
  p.onShow();
  assert.equal(p.data.cooldown, 0);
  p.onUnload();
});
test("phone edits discard code and provider errors never report success", async () => {
  const h = setup({
      "/core/auth/registration-code": () => ({
        http: 503,
        body: { code: 50321, message: "短信发送失败" },
      }),
    }),
    p = h.page("register");
  await p.onLoad();
  p.setData({ ...fields, smsCode: "123456" });
  p.input({
    currentTarget: { dataset: { name: "phone" } },
    detail: { value: "13900001235" },
  });
  assert.equal(p.data.smsCode, "");
  await p.sendCode();
  assert.equal(p.data.cooldown, 0);
  assert.equal(p.data.codeNotice, "");
  assert.equal(p.data.sendingCode, false);
  assert.match(p.data.error, /失败/);
});
test("new and legacy invitation links and QR scenes survive login/register navigation without persistent storage", async () => {
  for (const options of [
    { invite: "abcdefgh" },
    { code: "abcdefgh" },
    { scene: "invite%3DABCDEFGH" },
  ]) {
    const h = setup(),
      p = h.page("register");
    await p.onLoad(options);
    p.toLogin();
    assert.equal(h.navigation.at(-1), "/pages/login/index?invite=ABCDEFGH");
    const login = h.page("login");
    await login.onLoad();
    login.toRegister();
    assert.equal(h.navigation.at(-1), "/pages/register/index?invite=ABCDEFGH");
    assert.equal(h.storage.size, 0);
  }
});
test("stale registration policy cannot overwrite a newer retry", async () => {
  const old = deferred();
  let calls = 0;
  const h = setup({
      "/core/auth/registration-policy": () =>
        ++calls === 1 ? old.promise : { smsRequired: true, smsEnabled: true },
    }),
    p = h.page("register");
  const first = p.onLoad({ invite: "ABCDEFGH" });
  await new Promise((r) => setImmediate(r));
  await p.loadPolicy();
  old.resolve({ smsRequired: false });
  await first;
  assert.equal(p.data.policyReady, true);
});
