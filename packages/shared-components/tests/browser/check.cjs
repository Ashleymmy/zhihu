const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const out = path.resolve(
  process.env.COMPONENT_SCREENSHOTS || "改造/截图_2026-10-09/P1-1-components",
);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
  });
  const results = [];
  try {
    for (const width of [1440, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 1080 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(process.env.COMPONENT_URL || "http://127.0.0.1:34421/");
      await page
        .getByRole("heading", { name: "上传与核对", exact: true })
        .waitFor();
      const fits = async () =>
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          width + " horizontal overflow",
        );
      await fits();
      await page.screenshot({
        path: path.join(out, "overview-" + width + ".png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "先跳过", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-testid=answer]").textContent === "skip",
      );
      await page.getByRole("button", { name: /^需要跟进/ }).click();
      assert.equal(
        await page.locator(".grid-totals").innerText(),
        "记录\n2 条\n数量\n9\n已算出金额\n¥6.00",
      );
      await page.getByRole("searchbox").fill("悬疑");
      assert.ok(
        (await page.locator(".grid-totals").innerText()).includes("¥0.00"),
      );
      assert.ok(
        (await page.locator(".grid-totals").innerText()).includes("1 条"),
      );
      await page.screenshot({
        path: path.join(out, "filtered-" + width + ".png"),
        fullPage: true,
      });
      await fits();
      await page.getByRole("searchbox").fill("没有这个内容");
      await page.getByRole("button", { name: "清除搜索", exact: true }).click();
      await page
        .getByRole("combobox", { name: "分组方式" })
        .selectOption("person");
      await page
        .getByRole("button", { name: "指定执行人", exact: true })
        .click();
      assert.equal(
        await page.locator("[data-testid=action]").innerText(),
        "assign",
      );
      assert.equal(await page.locator("dialog[open]").count(), 0);
      await page.getByRole("button", { name: /^全部/ }).click();
      await page.getByRole("button", { name: "春日来信", exact: true }).click();
      await page.getByRole("dialog", { name: "春日来信" }).waitFor();
      assert.ok(
        (await page.getByRole("dialog").innerText()).includes(
          "3 × ¥8.00 = ¥24.00",
        ),
      );
      assert.ok(
        await page
          .locator("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page.screenshot({
        path: path.join(out, "details-" + width + ".png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "hidden" });
      const row = page
        .locator(width === 375 ? ".grid-card:visible" : ".grid-row:visible")
        .first();
      await row.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "关闭详情", exact: true }).click();
      await page.locator("dialog").waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      results.push({
        width,
        filterTotals: true,
        questionAnswer: true,
        rowActionDoesNotOpenDrawer: true,
        keyboardDrawer: true,
        noOverflow: true,
      });
      await page.close();
    }
    fs.writeFileSync(
      path.join(out, "results.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
