import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(fileURLToPath(new URL("./clarity-overrides.css", import.meta.url)), "utf8");

describe("克制化界面样式", () => {
  it("在移动端收起侧栏后让主内容恢复全宽", () => {
    expect(stylesheet).toContain("@media (max-width: 950px)");
    expect(stylesheet).toMatch(/\.studio-content-shell\s*\{\s*width:\s*100%;\s*margin-left:\s*0;/);
  });

  it("保留明确的卡片表面与移动端内容内边距", () => {
    expect(stylesheet).toMatch(/\.metric-card, \.panel, \.signal-paper/);
    expect(stylesheet).toMatch(/@media \(max-width: 700px\)[\s\S]*\.studio-page\s*\{\s*padding:\s*20px 16px 36px;/);
  });
});
