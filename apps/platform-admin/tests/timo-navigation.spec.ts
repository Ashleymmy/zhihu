import { describe, it, expect } from "vitest";
import { fakeUser } from "@zhihu-koc/test-support";
import { canAccessPath } from "../src/access";
import { zhihuRoutesFor } from "../src/modules/zhihu/routes";

const childPaths = (role: "developer" | "admin" | "operator" | "leader" | "creator", duty?: string) =>
  zhihuRoutesFor(role, duty).flatMap((route) => route.children ?? []).map((route) => route.path);

describe("Timo navigation", () => {
  it("creator cannot enter the removed management pages, but retains the business workspace", () => {
    const u = fakeUser({ role: "creator" });
    for (const path of [
      "/projects",
      "/projects/1",
      "/modules",
      "/finance",
      "/finance/x",
    ])
      expect(canAccessPath(u, path), path).toBe(false);
    for (const path of [
      "/dashboard",
      "/modules/zhihu/operations",
      "/modules/zhihu/works/new",
    ])
      expect(canAccessPath(u, path), path).toBe(true);
  });
  it("operators never see finance pages, not even the merged history stubs", () => {
    const paths = childPaths("operator", "operations");
    expect(paths).toContain("operations");
    expect(paths).not.toContain("finance");
    for (const path of ["settlements", "earnings", "withdrawals", "appeals", "data-import"])
      expect(paths).not.toContain(path);
  });
  it("finance-duty staff land on the finance page and keep merged history stubs", () => {
    const paths = childPaths("admin", "finance");
    expect(paths).toContain("finance");
    expect(paths).not.toContain("operations");
    expect(paths).not.toContain("works");
    expect(paths).toContain("settlements");
    expect(paths).toContain("data-import");
  });
  it("members keep their business pages and the merged history stubs", () => {
    for (const role of ["leader", "creator"] as const) {
      const paths = childPaths(role);
      expect(paths).toContain("operations");
      expect(paths).toContain("works");
      expect(paths).toContain("works/new");
      expect(paths).toContain("settlements");
      expect(paths).toContain("appeals");
      expect(paths).not.toContain("finance");
    }
  });
  it("removed legacy pages are gone from every role's route table", () => {
    for (const role of ["developer", "admin", "operator", "leader", "creator"] as const) {
      const paths = childPaths(role, "all");
      for (const path of ["more", "dashboard", "orders", "plans", "tasks", "history", "salt", "comments", "risk", "media", "tags", "products", "assets", "knowledge", "analytics", "creative-tools", "system", "system/data", "system/site"])
        expect(paths, `${role} ${path}`).not.toContain(path);
    }
  });
});
