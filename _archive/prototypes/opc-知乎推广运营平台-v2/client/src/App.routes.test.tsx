import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main data-layout="workspace">{children}</main>,
}));

vi.mock("@/pages/LoginPage", () => ({ default: () => <div data-page="login" /> }));
vi.mock("@/pages/OverviewPage", () => ({ default: () => <div data-page="overview" /> }));
vi.mock("@/pages/CampaignsPage", () => ({ default: () => <div data-page="campaigns" /> }));
vi.mock("@/pages/KeywordsCallbacksPage", () => ({ default: () => <div data-page="keywords" /> }));
vi.mock("@/pages/AnalyticsPage", () => ({ default: () => <div data-page="analytics" /> }));
vi.mock("@/pages/EarningsPage", () => ({ default: () => <div data-page="earnings" /> }));
vi.mock("@/pages/WorkspaceModulePage", () => ({ default: () => <div data-page="workspace-module" /> }));
vi.mock("@/pages/NotFound", () => ({ default: () => <div data-page="not-found" /> }));

import { AppRouter } from "./App";

function renderRoute(path: string) {
  return renderToStaticMarkup(
    <Router hook={() => [path, () => undefined]}>
      <AppRouter />
    </Router>,
  );
}

const cases: Array<[string, string]> = [
  ["/login", "login"],
  ["/dashboard/overview", "overview"],
  ["/dashboard/campaigns", "campaigns"],
  ["/dashboard/keywords", "keywords"],
  ["/dashboard/analytics", "analytics"],
  ["/dashboard/earnings", "earnings"],
  ["/workspace/promote", "workspace-module"],
  ["/workspace/zhihu", "workspace-module"],
  ["/workspace/salt", "workspace-module"],
  ["/workspace/settlement", "workspace-module"],
  ["/workspace/creative", "workspace-module"],
  ["/workspace/risk", "workspace-module"],
  ["/tools/wordpacks", "workspace-module"],
  ["/tools/word-packs", "workspace-module"],
  ["/tools/landing-pages", "workspace-module"],
  ["/tools/assets", "workspace-module"],
  ["/tools/materials", "workspace-module"],
  ["/tools/activity", "workspace-module"],
];

describe("App 路由解析", () => {
  it.each(cases)("将 %s 解析为正确页面", (path, page) => {
    const html = renderRoute(path);
    expect(html).toContain(`data-page="${page}"`);
    if (page !== "login") expect(html).toContain('data-layout="workspace"');
  });
});
