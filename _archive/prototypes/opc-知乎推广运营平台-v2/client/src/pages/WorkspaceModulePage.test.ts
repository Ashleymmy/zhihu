import { describe, expect, it } from "vitest";
import { resolveWorkspaceModulePath, workspaceModuleAliases } from "./WorkspaceModulePage";

describe("工作台模块路由", () => {
  it("为兼容工具路径解析到对应的独立模块", () => {
    expect(resolveWorkspaceModulePath("/tools/word-packs")).toBe("/tools/wordpacks");
    expect(resolveWorkspaceModulePath("/tools/materials")).toBe("/tools/assets");
    expect(resolveWorkspaceModulePath("/workspace/risk")).toBe("/workspace/risk");
  });

  it("仅保留两个明确的历史工具别名", () => {
    expect(workspaceModuleAliases).toEqual({
      "/tools/word-packs": "/tools/wordpacks",
      "/tools/materials": "/tools/assets",
    });
  });
});
