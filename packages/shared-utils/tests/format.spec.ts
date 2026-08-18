import { describe, expect, it } from 'vitest'
import { formatCount, formatCurrency, formatDate, formatDateTime, formatFen, formatRate } from '../src'

describe('金额格式化（分 → 元）', () => {
  it('整数分转两位小数元', () => {
    expect(formatFen(12345)).toBe('123.45')
    expect(formatFen(100)).toBe('1.00')
    expect(formatFen(0)).toBe('0.00')
  })

  it('接受字符串形态的分', () => {
    expect(formatFen('12345')).toBe('123.45')
  })

  it('空值与非法值统一降级为占位符，不显示 NaN', () => {
    expect(formatFen(null)).toBe('—')
    expect(formatFen(undefined)).toBe('—')
    expect(formatFen('')).toBe('—')
    expect(formatFen('abc')).toBe('—')
    expect(formatFen(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('负数金额（冲正）正常展示', () => {
    expect(formatFen(-500)).toBe('-5.00')
  })

  it('带货币符号', () => {
    expect(formatCurrency(12345)).toBe('¥123.45')
    expect(formatCurrency(null)).toBe('—')
  })
})

describe('比率与计数格式化', () => {
  it('0–1 小数转百分比', () => {
    expect(formatRate(0.1234)).toBe('12.34%')
    expect(formatRate(0)).toBe('0.00%')
    expect(formatRate(1)).toBe('100.00%')
  })

  it('比率空值降级', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(undefined)).toBe('—')
  })

  it('计数千分位', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
    expect(formatCount(null)).toBe('—')
  })
})

describe('时间格式化', () => {
  it('Date 对象格式化到分钟', () => {
    const date = new Date(2026, 7, 18, 9, 5)
    expect(formatDateTime(date)).toBe('2026-08-18 09:05')
    expect(formatDate(date)).toBe('2026-08-18')
  })

  it('非法时间降级', () => {
    expect(formatDateTime('not-a-date')).toBe('—')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
  })
})
