const assert = require("node:assert/strict");
const { harness } = require("../tests/harness.cjs");
async function main() {
  const username = process.env.WEIXIN_SMOKE_USERNAME;
  const password = process.env.WEIXIN_SMOKE_PASSWORD;
  const base = process.env.WEIXIN_SMOKE_API || "http://127.0.0.1:3001/api/v1";
  assert.ok(
    username && password,
    "Set WEIXIN_SMOKE_USERNAME and WEIXIN_SMOKE_PASSWORD for an existing admin account",
  );
  const h = harness(async (call) => {
    assert.ok(
      call.method === "GET" ||
        ["/core/auth/login", "/core/auth/logout"].includes(call.path),
      "Smoke test must not write business data",
    );
    const url = new URL(base + call.path);
    if (call.method === "GET")
      for (const [key, value] of Object.entries(call.data || {}))
        url.searchParams.set(key, value);
    const response = await fetch(url, {
      method: call.method,
      headers: call.header,
      body: call.method === "GET" ? undefined : JSON.stringify(call.data),
      signal: AbortSignal.timeout(15000),
    });
    return { http: response.status, body: await response.json() };
  });
  const auth = h.load("utils/auth");
  const user = await auth.login(username, password);
  try {
    assert.equal(
      user.role,
      "admin",
      "Use an admin account to inspect all migrated pages",
    );
    assert.equal(
      user.adminDuty || "all",
      "all",
      "Use an all-duty admin account",
    );
    assert.ok(
      !user.mustChangePwd,
      "Change the temporary password before running this read-only smoke check",
    );
    for (const name of [
      "home",
      "keywords",
      "works",
      "wallet",
      "withdrawals",
      "team",
      "projects",
      "admin",
      "prices",
      "password",
    ]) {
      const page = h.page(name);
      await page.onShow();
      assert.equal(page.data.error, "", name + ": " + page.data.error);
      assert.equal(page.data.allowed, true, name + ": no permission");
      assert.equal(
        page.data.scopeReady,
        true,
        name + ": configure project and integration first",
      );
      page.onHide();
      console.log(name + ": loaded successfully from live API");
    }
    console.log(
      "Read-only smoke passed; no business records were created or changed",
    );
  } finally {
    await auth.logout();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
