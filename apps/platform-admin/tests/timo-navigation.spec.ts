import { describe, it, expect } from "vitest";
import { fakeUser } from "@zhihu-koc/test-support";
import { canAccessPath } from "../src/access";
import { zhihuRoutesFor } from "../src/modules/zhihu/routes";
import { workspaceNavigation } from '../src/navigation';

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
      for (const path of ["more", "dashboard", "orders", "plans", "tasks", "history", "comments", "media", "tags", "products", "assets", "knowledge", "analytics", "creative-tools", "system", "system/data", "system/site"])
        expect(paths, `${role} ${path}`).not.toContain(path);
    }
  });
  it('published project tools have live scoped routes without primary navigation or extra role access',()=>{
    expect(childPaths('admin','operations')).toContain('risk');expect(childPaths('developer')).toContain('salt');expect(childPaths('operator')).toContain('salt');expect(childPaths('operator')).not.toContain('risk');
    for(const role of ['leader','creator'] as const){expect(childPaths(role)).not.toContain('salt');expect(childPaths(role)).not.toContain('risk')}
    expect(childPaths('admin','finance')).not.toContain('salt');expect(childPaths('admin','finance')).not.toContain('risk');
    for(const role of ['developer','admin','operator','leader','creator'] as const){const nav=workspaceNavigation(fakeUser({role}),true).flatMap(g=>g.items).map(i=>i.path);expect(nav).not.toContain('/modules/zhihu/salt');expect(nav).not.toContain('/modules/zhihu/risk')}
  });
  it('current inspection and queue observations are developer-only',()=>{for(const role of ['admin','operator','leader','creator'] as const)for(const path of ['/system/inspect','/system/queue'])expect(canAccessPath(fakeUser({role}),path)).toBe(false);expect(canAccessPath(fakeUser({role:'developer'}),'/system/inspect')).toBe(true)});
});
