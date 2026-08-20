import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    user: { name: "运营成员" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      profile: {
        useQuery: () => ({ data: { role: "leader" } }),
      },
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard/overview", vi.fn()],
}));

import DashboardLayout from "./DashboardLayout";

describe("DashboardLayout 渲染", () => {
  it("渲染顶部上下文、核心导航和页面主内容容器", () => {
    const html = renderToStaticMarkup(
      <DashboardLayout>
        <section data-testid="page-content">页面内容</section>
      </DashboardLayout>,
    );

    expect(html).toContain('class="studio-header"');
    expect(html).toContain("运营概览");
    expect(html).toContain("新建计划");
    expect(html).toContain("推广计划");
    expect(html).toContain('class="studio-page"');
    expect(html).toContain('data-testid="page-content"');
  });
});
