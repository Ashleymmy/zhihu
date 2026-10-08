export interface BusinessPage {
  path: string;
  meta?: { title?: unknown };
}
export const dailyPages = [
  "operations",
  "wallet",
  "finance",
  "dashboard",
  "plans",
  "works",
  "tasks",
];
export const retiredFinancePages = ['settlements', 'earnings', 'withdrawals', 'appeals'];
export const hiddenBusinessPages = ['orders', 'knowledge', 'creative-tools', ...retiredFinancePages];
export function businessPages<T extends BusinessPage>(
  pages: T[],
  role: string,
  duty = "all",
  includeHidden = false,
): T[] {
  if (role === "developer") duty = "all";
  if (role === "operator") duty = "operations";
  return pages.filter((page) => {
    if (!includeHidden && hiddenBusinessPages.includes(page.path)) return false;
    if (["keywords", "more", "works/new"].includes(page.path)) return false;
    if (!["developer", "admin", "operator"].includes(role)) return true;
    if (duty === "finance")
      return [
        "dashboard",
        "finance",
        "data-import",
        "settlements",
        "earnings",
        "withdrawals",
        "appeals",
        "orders",
      ].includes(page.path);
    if (duty === "operations")
      return ![
        "finance",
        "wallet",
        "settlements",
        "earnings",
        "withdrawals",
        "appeals",
        "data-import",
        "callbacks",
        "system",
        "system/data",
        "system/site",
      ].includes(page.path);
    return page.path !== "wallet";
  });
}
export const businessLabel = (page: BusinessPage, role: string) =>
  page.path === 'plans' && role === 'creator' ? '我的计划' :
  page.path === "operations"
    ? role === "creator"
      ? "我的关键词"
      : role === 'leader' ? '团队业务' : "关键词与团队"
    : String(page.meta?.title ?? page.path);
