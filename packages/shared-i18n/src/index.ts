import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

export const LOCALES = ['zh-CN', 'en-US'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'zh-CN'

/** 以 zh-CN 的结构为基准、把叶子放宽为 string——其余 locale 必须结构完全一致。 */
type DeepMessages<T> = { readonly [K in keyof T]: T[K] extends string ? string : DeepMessages<T[K]> }
export type Messages = DeepMessages<typeof zhCN>

export const messages: Record<Locale, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

type Path<T> = T extends Record<string, unknown>
  ? { [K in keyof T & string]: T[K] extends Record<string, unknown> ? `${K}.${Path<T[K]>}` : K }[keyof T & string]
  : never

export type MessageKey = Path<Messages>

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** 按点分路径取文案；缺失时返回 key 本身，便于定位漏翻。 */
export function translate(locale: Locale, key: MessageKey): string {
  const segments = key.split('.')
  let current: unknown = messages[locale]
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return key
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' ? current : key
}

export function createTranslator(locale: Locale) {
  return (key: MessageKey) => translate(locale, key)
}

export { zhCN, enUS }
