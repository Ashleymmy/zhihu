import { describe, expect, it } from "vitest";
import { permissions } from "./access";

describe("Aurora Control Room 角色权限", () => {
  it("为 boss 提供完整运营权限", () => {
    expect(permissions.boss).toContain("role.manage");
    expect(permissions.boss).toContain("campaign.write");
  });

  it("限制 member 为只读角色", () => {
    expect(permissions.member).toContain("overview.read");
    expect(permissions.member).not.toContain("campaign.write");
    expect(permissions.member).not.toContain("callback.write");
  });
});
