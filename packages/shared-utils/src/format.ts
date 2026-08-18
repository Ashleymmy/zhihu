/**
 * 金额分层（01 §金额）：传输与计算一律用「分」的整数，仅在展示层格式化为元。
 * 前端永不参与金额计算，只做展示格式化。
 */

/** 分 → 展示用元字符串，保留两位小数。 */
export function formatFen(fen: number | string | null | undefined): string {
  if (fen === null || fen === undefined || fen === '') return '—'
  const value = typeof fen === 'string' ? Number(fen) : fen
  if (!Number.isFinite(value)) return '—'
  return (value / 100).toFixed(2)
}

/** 分 → 带货币符号的展示串。 */
export function formatCurrency(fen: number | string | null | undefined, symbol = '¥'): string {
  const amount = formatFen(fen)
  return amount === '—' ? amount : `${symbol}${amount}`
}

/** 0–1 小数比率 → 百分比展示串。 */
export function formatRate(rate: number | null | undefined, fractionDigits = 2): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(fractionDigits)}%`
}

/** 大数字千分位展示。 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('zh-CN')
}

/** ISO 字符串 → `YYYY-MM-DD HH:mm`（本地时区）。 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** ISO 字符串 → `YYYY-MM-DD`。 */
export function formatDate(value: string | Date | null | undefined): string {
  const formatted = formatDateTime(value)
  return formatted === '—' ? formatted : formatted.slice(0, 10)
}
