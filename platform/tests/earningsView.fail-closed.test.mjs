import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/views/dashboard/EarningsView.vue", import.meta.url),
  "utf8",
);

test("提现入口保持资金 Gate fail closed", () => {
  assert.ok(source.includes("提现暂未开放"));
  assert.ok(source.includes("资金链未开放"));
  assert.ok(source.includes("状态以审核为准"));
  assert.ok(source.includes("disabled"));
  assert.ok(!source.includes("withdrawalsApi.create"));
  assert.ok(!source.includes("message.success"));
  assert.ok(!source.includes("预计 1-3 个工作日到账"));
  assert.ok(!source.includes("7日内到账"));
  assert.ok(!source.includes("可立即提现"));
  assert.ok(!source.includes("withdrawAmount"));
  assert.ok(!/withdrawableAmount|withdrawAmount/.test(source));
  assert.ok(
    !/label:\s*["']可提现["'][\s\S]{0,160}(?:settled|paid)/.test(source),
  );
});
