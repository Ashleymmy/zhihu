const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { harness } = require("./harness.cjs");
for (const role of ["creator", "leader", "operator", "admin", "developer"])
  test(
    "support is available to " + role + " without project permissions",
    async () => {
      const user = { id: "1", userId: "timo000001", role },
        settings = {
          miniContactEnabled: true,
          serviceUrl: "https://applink.feishu.cn/example",
          businessUrl: "",
          serviceHours: "",
        };
      const h = harness((c) => {
        if (c.path === "/core/auth/me") return user;
        if (c.path === "/core/support") return settings;
        throw Error("Unexpected " + c.path);
      });
      h.session(user);
      const page = h.page("support");
      await page.onShow();
      assert.equal(page.data.allowed, true);
      assert.equal(page.data.settings.miniContactEnabled, true);
      assert.equal(
        h.calls.some((c) => c.path.startsWith("/core/projects")),
        false,
      );
    },
  );
test("customer chat uses WeChat native contact and does not disclose account details in its source", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../miniprogram/pages/support/index.wxml"),
    "utf8",
  );
  assert.match(source, /open-type="contact"/);
  assert.match(source, /wx:if="{{settings.miniContactEnabled}}"/);
  assert.match(source, /session-from="support-page"/);
});
