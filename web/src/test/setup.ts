/**
 * Vitest 全局测试初始化
 * docs/05-测试文档.md §2.1
 *
 * ⚠️  onUnhandledRequest: 'error' 是核心保障：
 *    任何未被 MSW handler 拦截的请求都会让测试失败，
 *    确保测试环境绝不会意外打到真实 API。
 */
import { setupServer } from 'msw/node'
import { beforeAll, afterAll, afterEach } from 'vitest'

// 空 handler 列表作为默认，各测试文件按需传入具体 handler
export const server = setupServer()

beforeAll(() =>
  server.listen({
    onUnhandledRequest: 'error', // 未处理请求 → 测试立即失败
  }),
)

afterEach(() => server.resetHandlers())

afterAll(() => server.close())
