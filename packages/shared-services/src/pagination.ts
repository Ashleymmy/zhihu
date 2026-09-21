/**
 * Read every page from the paginated BFF resources used by the workbenches.
 * The API deliberately caps a single response at 100 records; callers should
 * use this helper whenever a screen needs the complete list for a selector or
 * an unpaginated table.
 */
export async function fetchAllPages<T>(
  request: (params: { page: number; pageSize: number }) => Promise<{ list: T[]; total: number; pageSize?: number }>,
  pageSize = 100,
  identity: (item: T) => unknown = item => item && typeof item === 'object' && 'id' in item ? item.id : undefined,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('每页数量须为 1–100')
  const items: T[] = []
  const ids = new Set<string>()
  let total: number | undefined
  for (let page = 1; ; page += 1) {
    const result = await request({ page, pageSize })
    const size = result.pageSize ?? pageSize
    if (!Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0 ||
        !Number.isInteger(size) || size < 1 || size > pageSize || result.list.length > size) {
      throw new Error('列表响应不完整，请刷新重试')
    }
    if (total !== undefined && total !== result.total) throw new Error('列表已发生变化，请刷新重试')
    total = result.total
    pageSize = size
    for (const item of result.list) {
      const key = identity(item)
      if (key != null) {
        const id = String(key)
        if (ids.has(id)) throw new Error('列表分页重复，请刷新重试')
        ids.add(id)
      }
    }
    items.push(...result.list)
    if (items.length === total) break
    if (items.length > total || result.list.length < size) throw new Error('列表数据未完整返回，请刷新重试')
  }
  return items
}

export interface OffsetPage<T> {
  data?: T[]
  pagination?: { total?: number; offset?: number; limit?: number }
}

/** Read all records from an official offset/limit endpoint. */
export async function fetchAllOffsetPages<T>(
  request: (params: { offset: number; limit: number }) => Promise<OffsetPage<T> | T[]>,
  limit = 100,
): Promise<{ items: T[]; total: number }> {
  const items: T[] = []
  const pages = new Set<string>()
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('每页数量须为 1–100')
  let offset = 0
  let total: number | undefined
  do {
    const response = await request({ offset, limit })
    const page = Array.isArray(response) ? response : response?.data
    const pagination = Array.isArray(response) ? undefined : response.pagination
    if (!Array.isArray(page)) throw new Error('知乎列表响应格式不正确')
    const size = pagination?.limit ?? limit
    if (!Number.isInteger(size) || size < 1 || size > limit || page.length > size ||
        (pagination?.offset !== undefined && pagination.offset !== offset)) throw new Error('知乎分页响应不正确')
    const nextTotal = pagination?.total
    if (nextTotal !== undefined && (!Number.isSafeInteger(nextTotal) || nextTotal < 0)) throw new Error('知乎列表总数不正确')
    if (total !== undefined && nextTotal !== undefined && total !== nextTotal) throw new Error('知乎列表已发生变化，请刷新重试')
    const fingerprint = JSON.stringify(page)
    if (page.length && pages.has(fingerprint)) throw new Error('知乎分页重复，请刷新重试')
    pages.add(fingerprint)
    items.push(...page)
    total = nextTotal ?? total
    if (total !== undefined) {
      if (items.length === total) break
      if (items.length > total || page.length < size) throw new Error('知乎列表数据未完整返回，请刷新重试')
    } else if (page.length < size) break
    offset += size
    limit = size
  } while (true)
  return { items, total: total ?? items.length }
}
