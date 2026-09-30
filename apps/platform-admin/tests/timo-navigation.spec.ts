import { describe, it, expect } from "vitest";
import { fakeUser } from "@zhihu-koc/test-support";
import { canAccessPath } from "../src/access";
import { businessPages, dailyPages } from "../../module-views/zhihu/navigation";
const pages = [
  "operations",
  "wallet",
  "finance",
  "dashboard",
  "plans",
  "works",
  "tasks",
  "history",
  "more",
  "keywords",
  "works/new",
  "orders",
  "callbacks",
  "system",
].map((path) => ({ path }));
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
      "/modules/zhihu/more",
    ])
      expect(canAccessPath(u, path), path).toBe(true);
  });
  it("daily actions include works and tasks and technical routes never become function tiles", () => {
    expect(dailyPages).toContain("works");
    expect(dailyPages).toContain("tasks");
    for (const role of [
      "developer",
      "admin",
      "operator",
      "leader",
      "creator",
    ]) {
      const visible = businessPages(pages, role).map((p) => p.path);
      for (const path of ["more", "keywords", "works/new"])
        expect(visible).not.toContain(path);
    }
  });
  it("operations and finance duties filter their actual destinations", () => {
    expect(businessPages(pages, "operator").map((p) => p.path)).not.toEqual(
      expect.arrayContaining(["finance", "callbacks", "system"]),
    );
    const finance = businessPages(pages, "admin", "finance").map((p) => p.path);
    expect(finance).toContain("finance");
    expect(finance).not.toContain("operations");
    expect(finance).not.toContain("works");
    expect(
      businessPages(pages, "developer", "finance").map((p) => p.path),
    ).toContain("system");
  });
});
