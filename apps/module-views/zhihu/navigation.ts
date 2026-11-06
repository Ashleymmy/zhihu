export interface BusinessPage {
  path: string;
  meta?: { title?: unknown };
}
// 这些财务旧页已合并进平台「财务 / 我的收益」，ModuleNavigation 对它们展示合并说明与历史记录。
export const retiredFinancePages = ['settlements', 'earnings', 'withdrawals', 'appeals', 'data-import'];
