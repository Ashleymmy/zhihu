import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpClient, createMemoryTokenStore, isApiError } from '../src'

const requestMock = vi.fn()
const interceptorHandlers: Array<(config: any) => any> = []

vi.mock('axios', () => ({
  default: {
    create: () => ({
      request: requestMock,
      interceptors: {
        request: {
          use: (handler: (config: any) => any) => {
            interceptorHandlers.push(handler)
          },
        },
      },
    }),
  },
}))

const envelope = <T>(data: T) => ({
  data: { code: 0, data, message: 'ok', requestId: 'req-1', timestamp: 1 },
  status: 200,
})

const httpError = (status: number, body: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: body } })

describe('HTTP 客户端', () => {
  beforeEach(() => {
    requestMock.mockReset()
    interceptorHandlers.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('成功响应解出 envelope 的 data', async () => {
    requestMock.mockResolvedValueOnce(envelope({ id: '1' }))
    const client = createHttpClient({ tokenStore: createMemoryTokenStore() })
    await expect(client.get('/x')).resolves.toEqual({ id: '1' })
  })

  it('请求拦截器附加 Bearer Token', async () => {
    const tokens = createMemoryTokenStore()
    tokens.set('token-a')
    createHttpClient({ tokenStore: tokens })
    const config = interceptorHandlers[0]?.({ headers: {} })
    expect(config.headers.Authorization).toBe('Bearer token-a')
  })

  it('无 Token 时不附加 Authorization 头', async () => {
    createHttpClient({ tokenStore: createMemoryTokenStore() })
    const config = interceptorHandlers[0]?.({ headers: {} })
    expect(config.headers.Authorization).toBeUndefined()
  })

  it('code 非 0 时抛出带 requestId 的 ApiError', async () => {
    requestMock.mockResolvedValueOnce({
      data: { code: 40301, data: null, message: '无权执行此操作', requestId: 'req-9' },
      status: 200,
    })
    const client = createHttpClient({ tokenStore: createMemoryTokenStore() })
    await expect(client.get('/x')).rejects.toMatchObject({ code: 40301, requestId: 'req-9' })
  })

  it('401 触发刷新并重放原请求', async () => {
    const tokens = createMemoryTokenStore()
    tokens.set('stale')
    requestMock
      .mockRejectedValueOnce(httpError(401))
      .mockResolvedValueOnce(envelope({ token: 'fresh', user: { id: '1' } }))
      .mockResolvedValueOnce(envelope({ id: 'replayed' }))

    const client = createHttpClient({ tokenStore: tokens })
    await expect(client.get('/protected')).resolves.toEqual({ id: 'replayed' })
    expect(tokens.get()).toBe('fresh')
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it('刷新失败时清空 Token 并回调 onUnauthorized', async () => {
    const tokens = createMemoryTokenStore()
    tokens.set('stale')
    const onUnauthorized = vi.fn()
    requestMock.mockRejectedValueOnce(httpError(401)).mockRejectedValueOnce(httpError(401))

    const client = createHttpClient({ tokenStore: tokens, onUnauthorized })
    await expect(client.get('/protected')).rejects.toMatchObject({ status: 401 })
    expect(tokens.get()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('重放后仍 401 不会无限重试', async () => {
    const tokens = createMemoryTokenStore()
    tokens.set('stale')
    requestMock
      .mockRejectedValueOnce(httpError(401))
      .mockResolvedValueOnce(envelope({ token: 'fresh', user: { id: '1' } }))
      .mockRejectedValueOnce(httpError(401))

    const client = createHttpClient({ tokenStore: tokens })
    await expect(client.get('/protected')).rejects.toMatchObject({ status: 401 })
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it('并发 401 只发起一次刷新——避免 Refresh Token 被判重放', async () => {
    const tokens = createMemoryTokenStore()
    tokens.set('stale')
    let refreshCalls = 0
    requestMock.mockImplementation(async (config: any) => {
      if (config.url === '/auth/refresh') {
        refreshCalls += 1
        return envelope({ token: 'fresh', user: { id: '1' } })
      }
      if (tokens.get() === 'stale') throw httpError(401)
      return envelope({ url: config.url })
    })

    const client = createHttpClient({ tokenStore: tokens })
    const results = await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')])
    expect(refreshCalls).toBe(1)
    expect(results).toHaveLength(3)
  })

  it('403 不触发刷新，且补齐可读文案', async () => {
    const tokens = createMemoryTokenStore()
    tokens.set('valid')
    requestMock.mockRejectedValueOnce(httpError(403, {}))

    const client = createHttpClient({ tokenStore: tokens })
    await expect(client.get('/forbidden')).rejects.toMatchObject({
      status: 403,
      message: '没有权限执行该操作',
    })
    expect(tokens.get()).toBe('valid')
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('50310 保留 failedGates 供财务页面展示', async () => {
    requestMock.mockRejectedValueOnce(
      httpError(503, { code: 50310, message: '财务链路未开放', failedGates: ['D-001-DECISION', 'P0-008'] }),
    )
    const client = createHttpClient({ tokenStore: createMemoryTokenStore() })
    const error = await client.get('/withdrawals').catch((raw) => raw)
    expect(isApiError(error)).toBe(true)
    expect(error.failedGates).toEqual(['D-001-DECISION', 'P0-008'])
  })

  it('网络错误归一化为 NETWORK_ERROR', async () => {
    requestMock.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }))
    const client = createHttpClient({ tokenStore: createMemoryTokenStore() })
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})
