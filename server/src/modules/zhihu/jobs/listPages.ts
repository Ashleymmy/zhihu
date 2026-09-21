export function listOf(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) return response as Array<Record<string, unknown>>;
  if (!response || typeof response !== 'object') throw new Error('知乎列表响应格式不正确');
  const value = response as Record<string, unknown>;
  if (Array.isArray(value.data)) return value.data as Array<Record<string, unknown>>;
  const data = value.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : value;
  if (Array.isArray(data.list)) return data.list as Array<Record<string, unknown>>;
  if (Array.isArray(data.items)) return data.items as Array<Record<string, unknown>>;
  if (Array.isArray(value.list)) return value.list as Array<Record<string, unknown>>;
  if (value.data === null) return [];
  throw new Error('知乎列表响应格式不正确');
}

export async function* listPages(fetchPage: (offset: number, limit: number) => Promise<unknown>, identity: (item: Record<string, unknown>) => string) {
  const limit = 100, seen = new Set<string>();
  for (let offset = 0; ; offset += limit) {
    const response = await fetchPage(offset, limit);
    const items = listOf(response);
    const pagination = (response as { pagination?: { total?: unknown } })?.pagination;
    const total = pagination?.total == null ? null : Number(pagination.total);
    if (!items.length) {
      if (total !== null && Number.isFinite(total) && offset < total) throw new Error('知乎分页数据不完整，请重试同步');
      return;
    }
    if (items.every(item => seen.has(identity(item)))) throw new Error('知乎分页重复，请重试同步');
    for (const item of items) {
      const id = identity(item);
      if (!seen.has(id)) { seen.add(id); yield item; }
    }
    if (total !== null && Number.isFinite(total)) {
      if (offset + items.length >= total) return;
      if (items.length < limit) throw new Error('知乎分页数据不完整，请重试同步');
    } else if (items.length < limit) return;
  }
}
