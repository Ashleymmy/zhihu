import { describe, expect, it } from "vitest";
import { navigation, pageMeta } from "./DashboardLayout";

describe("运营工作台导航", () => {
  it("保留核心运营、知乎工作台与运营工具入口", () => {
    expect(navigation.map(group => group.label)).toEqual([
      "运营",
      "洞察",
      "配置",
      "知乎工作台",
      "运营工具",
    ]);

    expect(navigation.flatMap(group => group.items.map(item => item.path))).toEqual(expect.arrayContaining([
      "/dashboard/overview",
      "/dashboard/campaigns",
      "/workspace/zhihu",
      "/tools/wordpacks",
    ]));
  });

  it("为核心路由提供清晰的顶部上下文", () => {
    expect(pageMeta["/dashboard/overview"]?.title).toBe("运营概览");
    expect(pageMeta["/dashboard/overview"]?.code).toBe("01");
    expect(pageMeta["/dashboard/campaigns"]?.title).toBe("推广计划");
    expect(pageMeta["/dashboard/campaigns"]?.code).toBe("02");
    expect(pageMeta["/workspace/zhihu"]?.title).toBe("知乎工作台");
    expect(pageMeta["/workspace/zhihu"]?.code).toBe("07");
    expect(pageMeta["/tools/activity"]?.code).toBe("15");
    expect(new Set(Object.values(pageMeta).map(item => item.code))).toHaveLength(15);
  });
});
