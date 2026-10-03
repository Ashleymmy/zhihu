const test = require("node:test"),
  assert = require("node:assert/strict");
const { harness } = require("./harness.cjs");
const { createBridge } = require("../cloudfunctions/opc-bridge/bridge");
const {
  textsFor,
  checkContent,
} = require("../cloudfunctions/opc-bridge/content-safety");
const context = () => ({
  APPID: "wx22b91776ccf37354",
  OPENID: "isolated_recent_wechat_identity",
});
const secret = "isolated_content_check_signing_secret_long";
test("moderation uses trusted identity and ignores forged client proof", async () => {
  let sent, checked;
  const bridge = createBridge({
    context,
    secret,
    check: async (input) => {
      checked = input;
      return {
        errcode: 0,
        result: { suggest: "pass" },
        trace_id: "provider-trace",
      };
    },
    send: async (_url, raw) => {
      sent = JSON.parse(raw);
      return { code: 0 };
    },
  });
  const r = await bridge({
    path: "/core/auth/profile",
    method: "POST",
    data: { displayName: "真实昵称" },
    openId: "forged",
    contentSafety: { version: 1, digest: "forged" },
  });
  assert.equal(r.code, 0);
  assert.equal(checked.openid, context().OPENID);
  assert.equal(checked.scene, 1);
  assert.equal(checked.version, 2);
  assert.equal(checked.content, "真实昵称");
  assert.notEqual(sent.contentSafety.digest, "forged");
  assert.deepEqual(sent.contentSafety.traceIds, ["provider-trace"]);
});
for (const result of [
  { errcode: 0, result: { suggest: "risky" } },
  { errCode: 0, result: { suggest: "review" } },
  { errcode: 45009 },
  { result: { suggest: "pass" } },
  null,
])
  test(
    "non-passing or malformed provider result cannot reach backend: " +
      JSON.stringify(result),
    async () => {
      let sent = 0;
      const bridge = createBridge({
        context,
        secret,
        check: async () => result,
        send: async () => {
          sent++;
          return { code: 0 };
        },
      });
      const r = await bridge({
        path: "/core/auth/register",
        method: "POST",
        data: { username: "someone", password: "SECRET" },
      });
      assert.notEqual(r.code, 0);
      assert.equal(sent, 0);
      assert.ok(!JSON.stringify(r).includes("SECRET"));
    },
  );
test("provider failure and missing provider fail closed, while login is independent", async () => {
  for (const check of [
    undefined,
    async () => {
      throw new Error("private_provider_secret");
    },
  ]) {
    let sent = 0;
    const bridge = createBridge({
      context,
      secret,
      check,
      send: async () => {
        sent++;
        return { code: 0 };
      },
    });
    const rejected = await bridge({
      path: "/core/auth/profile",
      method: "POST",
      data: { displayName: "new" },
    });
    assert.equal(rejected.code, 50332);
    assert.equal(sent, 0);
    assert.ok(!JSON.stringify(rejected).includes("private_provider_secret"));
    assert.equal(
      (
        await bridge({
          path: "/core/auth/login",
          method: "POST",
          data: { username: "person", password: "PASSWORD" },
        })
      ).code,
      0,
    );
    assert.equal(sent, 1);
  }
});
test("private credentials, contacts, banking details and files never enter text checks", () => {
  assert.deepEqual(
    textsFor("/core/auth/register", "POST", {
      username: "account",
      displayName: "名字",
      password: "secret",
      phone: "13912345678",
      smsCode: "123456",
    }),
    ["名字", "account"],
  );
  assert.deepEqual(
    textsFor("/core/auth/profile", "POST", { contact: "private_phone" }),
    [],
  );
  assert.deepEqual(
    textsFor("/core/finance/withdrawals", "POST", {
      receiverName: "姓名",
      bankAccount: "12345",
      remark: "private",
    }),
    [],
  );
  assert.deepEqual(
    textsFor("/core/account-privacy/closure", "POST", { password: "secret" }),
    [],
  );
  assert.deepEqual(
    textsFor("/core/files/chunk", "POST", { content: "base64" }),
    [],
  );
  assert.deepEqual(
    textsFor("/modules/zhihu/mini-import-works", "POST", {
      rows: [
        {
          mediaAccount: "账号名",
          promoUrl: "https://example.invalid",
          note: "备注",
        },
      ],
    }),
    ["账号名", "备注"],
  );
});
test("long text is checked in Unicode-safe chunks and oversized requests are rejected before billing", async () => {
  const calls = [];
  await checkContent(
    "/core/announcements",
    "POST",
    { content: "中".repeat(4500) },
    "id",
    async (input) => {
      calls.push(input);
      return { errcode: 0, result: { suggest: "pass" } };
    },
  );
  assert.deepEqual(
    calls.map((c) => Array.from(c.content).length),
    [2000, 2000, 500],
  );
  await assert.rejects(
    () =>
      checkContent(
        "/core/announcements",
        "POST",
        { content: "中".repeat(12001) },
        "id",
        async () => {
          throw new Error("should not call");
        },
      ),
    /分批/,
  );
});
function setup() {
  return harness((c) => {
    if (c.path === "/core/account-privacy/closure")
      return c.method === "POST"
        ? { closed: true }
        : { canClose: true, blockers: [] };
    return {};
  });
}
test("help is reachable as a guest without triggering authenticated requests", async () => {
  const h = setup(),
    mine = h.page("mine");
  mine.openPrivacy();
  assert.equal(h.navigation.at(-1), "/pages/privacy/index");
  const p = h.page("privacy");
  await p.onShow();
  assert.equal(h.calls.length, 0);
  assert.equal(p.data.user, null);
});
test("closure needs acknowledgement and password, cancel makes no write, completion clears shared session", async () => {
  const h = setup();
  h.session({ id: "123", role: "creator" });
  const p = h.page("privacy");
  await p.onShow();
  await p.closeAccount();
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
  p.setData({ password: "fixture", acknowledged: true });
  h.wx.showModal = (o) => o.success({ confirm: false });
  await p.closeAccount();
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
  h.wx.showModal = (o) => o.success({ confirm: true });
  await p.closeAccount();
  const sent = h.calls.find((c) => c.method === "POST");
  assert.equal(sent.data.userId, "123");
  assert.equal(sent.data.confirmation, "注销网站及小程序共用账号");
  assert.equal(h.storage.get("zk_token"), undefined);
  assert.equal(h.navigation.at(-1), "/pages/login/index");
});
test("blocked closure and hidden-page credentials cannot trigger a write", async () => {
  const h = setup();
  h.session({ id: "123", role: "creator" });
  const p = h.page("privacy");
  await p.onShow();
  p.setData({
    status: { canClose: false },
    password: "fixture",
    acknowledged: true,
  });
  await p.closeAccount();
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
  p.onHide();
  assert.equal(p.data.password, "");
  assert.equal(p.data.acknowledged, false);
});
