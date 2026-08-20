import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(fileURLToPath(new URL("./reference-workspace.css", import.meta.url)), "utf8");

describe("参考原型工作台样式", () => {
  it("使用低饱和暖白画布、细分隔线与橙色微强调", () => {
    expect(stylesheet).toContain("--paper: #f7f6f1");
    expect(stylesheet).toContain("--line: #d8d7d0");
    expect(stylesheet).toContain("--clay: #d4613e");
    expect(stylesheet).toContain("border-radius: 0");
  });

  it("在小屏幕将运营工作台双栏内容折叠为单列", () => {
    expect(stylesheet).toMatch(/@media \(max-width: 700px\)[\s\S]*\.overview-main-grid, \.overview-bottom-grid\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(stylesheet).toMatch(/\.studio-content-shell\s*\{\s*width:\s*100%;\s*margin-left:\s*0;/);
  });

  it("为全部业务页面提供各自的工作流表面规则", () => {
    expect(stylesheet).toContain(".login-editorial");
    expect(stylesheet).toContain(".analysis-intro .period-picker");
    expect(stylesheet).toContain(".balance-sheet");
    expect(stylesheet).toContain(".attribution-workspace");
    expect(stylesheet).toContain(".module-workspace");
    expect(stylesheet).toContain(".external-source-panel");
  });
});
