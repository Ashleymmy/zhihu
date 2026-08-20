import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({ path: "/workspace/zhihu" }));

vi.mock("wouter", () => ({
  useLocation: () => [routeState.path, vi.fn()],
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/trpc", () => {
  const query = () => ({ data: [], isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    trpc: {
      useUtils: () => ({
        workspace: { list: { invalidate: vi.fn() } },
        activity: { invalidate: vi.fn() },
        campaigns: { list: { invalidate: vi.fn() } },
      }),
      workspace: { list: { useQuery: query }, create: { useMutation: mutation } },
      activity: { useQuery: query },
      zhihu: { promotionTasks: { useQuery: query } },
      campaigns: {
        createZhihu: { useMutation: mutation },
        listZhihuBatches: { useQuery: query },
        getZhihuBatchResult: { useMutation: mutation },
      },
    },
  };
});

import WorkspaceModulePage from "./WorkspaceModulePage";

const routes: Array<[string, string]> = [
  ["/workspace/promote", "知乎推广不是一条孤立的投放线"],
  ["/workspace/zhihu", "把内容现场，变成日常工作台"],
  ["/workspace/salt", "让值得反复使用的内容"],
  ["/workspace/settlement", "每一次结算"],
  ["/workspace/creative", "好创意不是灵感闪现"],
  ["/workspace/risk", "把风险放在动作之前"],
  ["/tools/wordpacks", "词不是清单"],
  ["/tools/word-packs", "词不是清单"],
  ["/tools/landing-pages", "承接页的每一处"],
  ["/tools/assets", "素材需要被找到"],
  ["/tools/materials", "素材需要被找到"],
  ["/tools/activity", "每一项动作留下轨迹"],
];

describe("工作台模块页面渲染", () => {
  it.each(routes)("挂载 %s 时提供对应页面内容与主操作区", (path, heading) => {
    routeState.path = path;
    const html = renderToStaticMarkup(<WorkspaceModulePage />);

    expect(html).toContain(heading);
    expect(html).toContain("module-workspace");
    expect(html).toMatch(/module-primary|开始方式|工作记录/);
  });
});
