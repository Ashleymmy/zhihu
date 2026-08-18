import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, LOCALES, createTranslator, enUS, isLocale, messages, translate, zhCN } from '../src'

/** 递归收集所有叶子 key，用于跨 locale 结构比对。 */
function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}

describe('i18n', () => {
  it('两种 locale 的 key 集合完全一致——不允许漏翻', () => {
    expect(leafKeys(enUS).sort()).toEqual(leafKeys(zhCN).sort())
  })

  it('所有文案均为非空字符串', () => {
    for (const locale of LOCALES) {
      for (const key of leafKeys(messages[locale])) {
        const text = translate(locale, key as never)
        expect(text.length, `${locale}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('按点分路径取值', () => {
    expect(translate('zh-CN', 'auth.login')).toBe('登录')
    expect(translate('en-US', 'auth.login')).toBe('Sign in')
  })

  it('缺失 key 返回 key 本身而非崩溃', () => {
    expect(translate('zh-CN', 'nope.missing' as never)).toBe('nope.missing')
  })

  it('createTranslator 绑定 locale', () => {
    expect(createTranslator('en-US')('workspace.admin')).toBe('Admin Console')
  })

  it('isLocale 拒绝未知 locale，默认 locale 合法', () => {
    expect(isLocale('zh-CN')).toBe(true)
    expect(isLocale('ja-JP')).toBe(false)
    expect(isLocale(DEFAULT_LOCALE)).toBe(true)
  })
})
