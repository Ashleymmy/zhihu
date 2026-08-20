import { describe, expect, it } from "vitest";
import { getAuthenticatedLandingPath } from "./authRedirect";

describe("登录页认证跳转", () => {
  it("会将已认证且会话加载完成的用户带到数据总览", () => {
    expect(getAuthenticatedLandingPath(true, false)).toBe("/dashboard/overview");
  });

  it("会在会话仍加载或尚未认证时保留在登录页", () => {
    expect(getAuthenticatedLandingPath(true, true)).toBeNull();
    expect(getAuthenticatedLandingPath(false, false)).toBeNull();
  });
});
