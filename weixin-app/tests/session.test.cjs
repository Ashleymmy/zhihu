const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, deferred, scoped } = require("./harness.cjs");
test("role matrix denies unknown roles and uses backend default admin duty", () => {
  const p = harness().load("utils/permissions");
  for (const [role, duty, expected] of [
    // keywords/works/wallet 已迁到知乎工作台二级入口，不再出现在通用菜单里
    ["creator", null, []],
    ["leader", null, ["team", "prices"]],
    ["admin", "operations", ["team", "prices", "admin"]],
    ["admin", "finance", ["reports"]],
    ["admin", null, ["reports", "team", "prices", "admin"]],
    ["unknown", null, []],
  ])
    assert.deepEqual(
      Array.from(p.menus({ role, adminDuty: duty }), (x) => x.key),
      expected,
    );
});
test("login uses /me as authority and never restores a cached user blindly", async () => {
  const h = harness((c) =>
    c.path.endsWith("/login")
      ? { token: "new", user: { role: "admin" } }
      : { id: "7", role: "creator", mustChangePwd: true },
  );
  const user = await h.load("utils/auth").login("member", "password");
  assert.equal(user.role, "creator");
  assert.equal(user.mustChangePwd, true);
  assert.equal(h.calls[0].header.Authorization, undefined);
  assert.equal(h.calls[1].header.Authorization, "Bearer new");
});
test("profile loads for every supported role and stays inaccessible to guests and unknown roles", async () => {
  for (const user of [
    { id: "1", role: "creator" },
    { id: "2", role: "leader" },
    { id: "3", role: "admin", adminDuty: "operations" },
    { id: "4", role: "admin", adminDuty: "finance" },
    { id: "5", role: "admin", adminDuty: "all" },
    { id: "6", role: "unknown" },
    null,
  ]) {
    const h = harness((call) => {
      if (call.path === "/core/auth/profile") return user;
      if (call.path === "/core/auth/binding-status")
        return { bound: false, currentWechat: false };
      if (call.path === "/core/team/affiliation")
        return { team: null, inviter: null };
      assert.equal(call.path, "/modules/zhihu/invite/status");
      return { used: true };
    });
    if (user) h.session(user);
    const page = h.page("profile");
    await page.onShow();
    const allowed = !!user && user.role !== "unknown";
    assert.equal(page.data.allowed, allowed);
    assert.equal(page.data.denied, !!user && !allowed);
    assert.equal(
      h.calls.length,
      allowed ? (user.role === "creator" ? 4 : 3) : 0,
    );
    if (allowed) assert.equal(page.data.inviteUsed, true);
  }
});
test("network failure on restore shows an error without redirect loop, then retries", async () => {
  let offline = true;
  const h = harness(() =>
    offline ? { networkError: "request:fail" } : { id: "2", role: "creator" },
  );
  h.storage.set("zk_access_token", "saved");
  const login = h.page("login");
  await login.onLoad();
  assert.match(login.data.error, /无法连接/);
  assert.equal(h.navigation.length, 0);
  offline = false;
  await login.onLoad();
  assert.equal(h.navigation.at(-1), "/pages/home/index");
});
test("stale 401 from an earlier session cannot clear a fresh login", async () => {
  const wait = deferred(),
    h = harness(() => wait.promise);
  h.session();
  const req = h.load("utils/request").get("/old");
  h.storage.set("zk_access_token", "new-session");
  wait.resolve({ http: 401, body: { message: "expired" } });
  await assert.rejects(req, (e) => e.code === "SESSION_CHANGED");
  assert.equal(h.storage.get("zk_access_token"), "new-session");
  assert.equal(h.navigation.length, 0);
});
test("401 clears user, token and all project scope, while business errors do not", async () => {
  let expired = false;
  const h = harness(() =>
    expired
      ? { http: 401, body: { message: "expired" } }
      : { http: 422, body: { code: 42200, message: "bad input" } },
  );
  h.session();
  h.storage.set("zk_scope", { projectId: "1" });
  h.app.globalData.scope = { projectId: "1", accountId: "10" };
  await assert.rejects(h.load("utils/request").get("/test"), /bad input/);
  assert.ok(h.app.globalData.user);
  expired = true;
  await assert.rejects(h.load("utils/request").get("/test"), /expired/);
  assert.equal(h.app.globalData.user, null);
  assert.equal(h.storage.has("zk_scope"), false);
  assert.equal(h.app.globalData.scope.accountId, "");
});
test("concurrent restore followed by login does not overwrite new session", async () => {
  const old = deferred();
  const h = harness((c) =>
    c.path.endsWith("/login")
      ? { token: "new" }
      : c.header.Authorization === "Bearer old"
        ? old.promise
        : { id: "9", role: "creator" },
  );
  h.storage.set("zk_access_token", "old");
  const auth = h.load("utils/auth"),
    restoring = auth.ensure().catch((e) => e.code);
  const user = await auth.login("new", "password");
  old.resolve({ id: "1", role: "admin" });
  await restoring;
  assert.equal(user.id, "9");
  assert.equal(h.app.globalData.user.id, "9");
});
test("direct unauthorized finance/admin routes make no API calls or mutations", async () => {
  for (const [user, pageName] of [
    [{ id: "1", role: "creator" }, "admin"],
    [{ id: "1", role: "admin", adminDuty: "operations" }, "wallet"],
    [{ id: "1", role: "admin", adminDuty: "finance" }, "keywords"],
  ]) {
    const h = harness();
    h.session(user);
    const page = h.page(pageName);
    await page.onShow();
    assert.equal(page.data.denied, true);
    await page.action(() => {
      throw Error("should never run");
    });
    assert.equal(h.calls.length, 0);
  }
});
test("temporary password routes all business pages to password change", async () => {
  const h = harness();
  h.session({ id: "2", role: "creator", mustChangePwd: true });
  await h.page("keywords").onShow();
  assert.equal(h.navigation.at(-1), "/pages/password/index");
  assert.equal(h.calls.length, 0);
});
test("latest project selection wins when requests complete out of order", async () => {
  const one = deferred(),
    two = deferred();
  const h = harness((c) =>
    c.path === "/core/projects"
      ? [
          { id: "1", name: "one" },
          { id: "2", name: "two" },
        ]
      : c.path.includes("/1/")
        ? one.promise
        : two.promise,
  );
  h.session();
  const scope = h.load("utils/scope");
  const first = scope.load(true, "1"),
    second = scope.load(true, "2");
  two.resolve([
    { id: "20", name: "second", moduleId: "zhihu", status: "active" },
  ]);
  await second;
  one.resolve([
    { id: "10", name: "first", moduleId: "zhihu", status: "active" },
  ]);
  await first;
  assert.equal(h.app.globalData.scope.projectId, "2");
  assert.equal(h.storage.get("zk_scope").accountId, "20");
});
test("failed project selection clears old global scope and blocks stale actions", async () => {
  let fail = false;
  const h = harness((c) =>
    fail ? { networkError: "request:fail" } : scoped(c),
  );
  h.session();
  const scope = h.load("utils/scope");
  await scope.ensure();
  assert.equal(h.app.globalData.scope.accountId, "10");
  fail = true;
  await assert.rejects(scope.load(true, "2"));
  assert.equal(h.app.globalData.scope.accountId, "");
});
test("scope storage cannot be reused across accounts and logout removes scope", async () => {
  const h = harness((c) => scoped(c));
  h.session({ id: "2", role: "creator" });
  h.storage.set("zk_scope", { userId: "1", projectId: "99", accountId: "99" });
  await h.load("utils/scope").ensure();
  assert.equal(h.storage.get("zk_scope").userId, "2");
  await h.load("utils/auth").logout();
  assert.equal(h.storage.has("zk_access_token"), false);
  assert.equal(h.storage.has("zk_scope"), false);
});
