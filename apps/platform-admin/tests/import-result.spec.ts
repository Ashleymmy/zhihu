import { expect, it } from "vitest";
import type { DataImportProcessing } from "@zhihu-koc/shared-contracts";
import {
  importResultCopy,
  importResultLink,
  importIssueLabel,
} from "../src/modules/zhihu/data-import-result";
const result: DataImportProcessing = {
  state: "not_started",
  from: "2026-09-26",
  to: "2026-09-26",
  sourceOrders: "1",
  sourceSearches: "18",
  revenueProvided: false,
  matchedRows: 0,
  pendingRows: 0,
  exceptionRows: 0,
  issues: [],
  scope: { projectId: "1", accountId: "2" },
  attributionBatchId: null,
  retryAllowed: true,
};
it("explains saved versus attributed versus paid states", () => {
  expect(importResultCopy(result).title).toContain("归因尚未开始");
  expect(importResultCopy({ ...result, state: "analyzed" }).detail).toContain(
    "不代表已经付款",
  );
  expect(importResultCopy(undefined).detail).toContain("不能判断");
  expect(
    importResultCopy({ ...result, state: "legacy_pending" }).detail,
  ).toContain("历史归属");
});
it("keeps business dates and project context when navigating to statements or issues", () => {
  expect(importResultLink(result, "finance")).toBe(
    "/modules/zhihu/finance?projectId=1&accountId=2&from=2026-09-26&to=2026-09-26",
  );
  expect(importResultLink(result, "issues")).toContain("tab=issues");
  expect(importIssueLabel("PRICE_MISSING")).toContain("单价");
});
