const test = require("node:test"),
  assert = require("node:assert/strict");
const { harness, deferred } = require("./harness.cjs");
const fields = {
  username: "new_creator",
  password: "Account_test_123",
  agreed: true,
};
const policy = {
  registrationMode: "account",
  smsRequired: false,
  smsEnabled: false,
};
function setup(overrides = {}) {
  return harness((c) => {
    if (overrides[c.path]) return overrides[c.path](c);
    if (c.path.endsWith("/registration-policy")) return policy;
    if (c.path.endsWith("/register")) return { token: "fixture" };
    if (c.path.endsWith("/me"))
      return {
        id: "1",
        username: fields.username,
        role: "creator",
        phone: null,
        phoneVerifiedAt: null,
      };
    return {};
  });
}
test("hidden invitation is preserved through account registration without claiming a phone", async () => {
  const h = setup(),
    p = h.page("register");
  await p.onLoad({ invite: "abcdefgh" });
  p.setData(fields);
  await p.submit();
  const sent = h.calls.find((c) => c.path.endsWith("/register"));
  assert.equal(sent.data.inviteCode, "ABCDEFGH");
  assert.equal(sent.data.username, fields.username);
  assert.equal(sent.data.phone, undefined);
  assert.equal(sent.data.smsCode, undefined);
  assert.equal(h.load("utils/invitation").get(), "");
  assert.equal(h.storage.get("zk_user").phoneVerifiedAt, null);
});
test("no invitation and unavailable SMS still allow registration with no SMS or captcha request", async () => {
  const h = setup(),
    p = h.page("register");
  await p.onLoad();
  p.setData(fields);
  await p.submit();
  assert.equal(
    h.calls.find((c) => c.path.endsWith("/register")).data.inviteCode,
    undefined,
  );
  assert.ok(h.calls.every((c) => !/captcha|-code$/.test(c.path)));
  assert.ok(h.navigation.includes("/pages/home/index"));
});
test("invalid invitation is not silently converted into independent registration", async () => {
  const h = setup({
      "/core/auth/registration-policy": () => ({
        http: 422,
        body: { code: 42220, message: "邀请已失效" },
      }),
    }),
    p = h.page("register");
  await p.onLoad({ invite: "bad" });
  p.setData(fields);
  await p.submit();
  assert.equal(p.data.inviteCode, "BAD");
  assert.equal(p.data.policyReady, false);
  assert.ok(!h.calls.some((c) => c.path.endsWith("/register")));
});
test("failed or obsolete policy blocks submission and retry recovers", async () => {
  let response = { http: 503, body: { code: 50320, message: "稍后重试" } };
  const h = setup({ "/core/auth/registration-policy": () => response }),
    p = h.page("register");
  await p.onLoad();
  p.setData(fields);
  await p.submit();
  assert.equal(p.data.policyReady, false);
  response = { smsRequired: true, smsEnabled: true };
  await p.loadPolicy();
  assert.equal(p.data.policyReady, false);
  response = policy;
  await p.loadPolicy();
  await p.submit();
  assert.ok(h.calls.some((c) => c.path.endsWith("/register")));
});
test("consent and duplicate click prevention still protect account registration", async () => {
  const sending = deferred(),
    h = setup({ "/core/auth/register": () => sending.promise }),
    p = h.page("register");
  await p.onLoad();
  p.setData({ ...fields, agreed: false });
  await p.submit();
  assert.equal(p.data.consentOpen, true);
  assert.ok(!h.calls.some((c) => c.path.endsWith("/register")));
  p.confirmConsent();
  const first = p.submit();
  await p.submit();
  sending.resolve({ token: "fixture" });
  await first;
  assert.equal(h.calls.filter((c) => c.path.endsWith("/register")).length, 1);
});
test("duplicate username errors preserve input and do not report successful registration", async () => {
  const h = setup({
      "/core/auth/register": () => ({
        http: 409,
        body: { code: 40901, message: "用户名已被使用" },
      }),
    }),
    p = h.page("register");
  await p.onLoad();
  p.setData(fields);
  await p.submit();
  assert.match(p.data.error, /已被使用/);
  assert.equal(p.data.busy, false);
  assert.equal(p.data.username, fields.username);
  assert.equal(h.navigation.length, 0);
});
test("new and legacy invitation links and QR scenes survive login/register navigation", async () => {
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
        ++calls === 1 ? old.promise : policy,
    }),
    p = h.page("register");
  const first = p.onLoad();
  await new Promise((r) => setImmediate(r));
  await p.loadPolicy();
  old.resolve({ smsRequired: true });
  await first;
  assert.equal(p.data.policyReady, true);
});
