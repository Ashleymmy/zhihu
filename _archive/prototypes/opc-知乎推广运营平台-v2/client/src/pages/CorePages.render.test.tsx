import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const sharedQuery = { data: undefined, isLoading: false, error: null, isFetching: false, refetch: vi.fn() };
const sharedMutation = { mutate: vi.fn(), isPending: false };
const branch: Record<string | symbol, unknown> = new Proxy({}, {
  get(_target, key) {
    if (key === "useQuery") return () => sharedQuery;
    if (key === "useMutation") return () => sharedMutation;
    if (key === "invalidate") return vi.fn();
    return branch;
  },
});

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get(_target, key) {
      if (key === "useUtils") return () => branch;
      return branch;
    },
  }),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false, user: null, logout: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard/overview", vi.fn()],
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import AnalyticsPage from "./AnalyticsPage";
import CampaignsPage from "./CampaignsPage";
import EarningsPage from "./EarningsPage";
import KeywordsCallbacksPage from "./KeywordsCallbacksPage";
import LoginPage from "./LoginPage";
import OverviewPage from "./OverviewPage";

const routes: Array<[string, React.ComponentType, string, string]> = [
  ["/login", LoginPage, "login-editorial", "增长，是可以"],
  ["/dashboard/overview", OverviewPage, "overview-journal", "今天，先看清"],
  ["/dashboard/campaigns", CampaignsPage, "campaign-workspace", "把每次投放"],
  ["/dashboard/keywords", KeywordsCallbacksPage, "attribution-workspace", "ATTRIBUTION"],
  ["/dashboard/analytics", AnalyticsPage, "analysis-journal", "数据不是结论"],
  ["/dashboard/earnings", EarningsPage, "earnings-journal", "让每一笔收益"],
];

describe("核心运营页面渲染", () => {
  it.each(routes)("挂载 %s 时渲染页面主内容与核心操作区", (_path, Page, className, copy) => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain(className);
    expect(html).toContain(copy);
  });
});
