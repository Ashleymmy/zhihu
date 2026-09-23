import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Keywords from '../../module-views/zhihu/Keywords.vue'
import CashWallet from '../../../packages/shared-components/src/CashWallet.vue'
import type { EngineContext } from '../../module-views/zhihu/context'

const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)

describe('业务页面在 HTTP 环境下初始化', () => {
  beforeEach(() => {
    // Public HTTP origins expose getRandomValues, but not randomUUID.
    vi.stubGlobal('crypto', { getRandomValues })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('关键词页仍显示搜索和列表框架', async () => {
    const context: EngineContext = {
      http: {} as EngineContext['http'],
      coreHttp: {} as EngineContext['coreHttp'],
      scope: { projectId: '1', accountId: '1' },
      role: 'admin', userId: '1', parentId: null, adminDuty: 'all',
      options: { tasks: [], channels: [], mappings: [], users: [] },
    }
    const app = createSSRApp(Keywords, { context })
    app.component('RouterLink', { template: '<a><slot /></a>' })
    const errors: unknown[] = []
    app.config.errorHandler = error => errors.push(error)
    const html = await renderToString(app)
    expect(errors).toEqual([])
    expect(html).toContain('本地关键词管理')
    expect(html).toContain('查找关键词')
    expect(html).toMatch(/<table\b/)
  })

  it('提现页仍显示列表框架', async () => {
    const app = createSSRApp(CashWallet, {
      http: {} as EngineContext['http'],
      scope: { projectId: '1', accountId: '1', moduleId: 'zhihu' },
    })
    const errors: unknown[] = []
    app.config.errorHandler = error => errors.push(error)
    const html = await renderToString(app)
    expect(errors).toEqual([])
    expect(html).toContain('我的提现')
    expect(html).toContain('刷新')
  })
})
