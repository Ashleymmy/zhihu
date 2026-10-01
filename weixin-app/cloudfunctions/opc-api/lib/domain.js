const crypto = require('node:crypto')
class Fault extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code || status * 100 } }
const fail = (message, status = 422) => { throw new Fault(status, message) }
const text = (value, label, max = 128) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(label + '格式不正确'); return value.trim() }
const id = value => { const result = String(value || ''); if (!/^[1-9]\d{0,39}$/.test(result)) fail('记录 ID 格式不正确'); return result }
const uid = () => BigInt('0x' + crypto.randomBytes(16).toString('hex')).toString()
const clean = value => JSON.parse(JSON.stringify(value))
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o,k) => { if (v[k] !== undefined) o[k] = canonical(v[k]); return o }, {}) : v
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function cash(value, signed = false) {
  if (!(signed ? /^-?\d{1,16}(\.\d{1,4})?$/ : /^\d{1,16}(\.\d{1,4})?$/).test(String(value))) fail('金额须为最多四位小数的十进制字符串')
  const negative = String(value).startsWith('-'), [whole, fraction = ''] = String(value).replace(/^-/, '').split('.')
  return (BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))) * (negative ? -1n : 1n)
}
function money(n) { const x = n < 0n ? -n : n; if (x >= 10n ** 20n) fail('金额超出范围'); return (n < 0n ? '-' : '') + x / 10000n + '.' + String(x % 10000n).padStart(4, '0') }
function day(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v) fail('日期不正确'); return v }
const today = () => new Date(Date.now() + 28800000).toISOString().slice(0,10)
const now = () => new Date().toISOString()
function url(v) { try { const u = new URL(v); if (!['https:','http:'].includes(u.protocol) || u.username || u.password) fail('请输入公开 HTTP(S) 链接'); return text(v,'链接',2048) } catch (_) { fail('请输入公开 HTTP(S) 链接') } }
function page(list, input = {}) { const p = Number(input.page || 1), size = Number(input.pageSize || 20); if (!Number.isInteger(p) || p < 1 || !Number.isInteger(size) || size < 1 || size > 100) fail('分页参数不正确'); return { list: list.slice((p-1)*size,p*size), total: list.length, page: p, pageSize: size } }
function safeUser(u) { return { id:u.id, username:u.username, displayName:u.displayName, role:u.role, adminDuty:u.adminDuty || 'all', parentId:u.parentId || null, phone:u.phone || null, contact:u.contact || null, isActive:!!u.isActive, mustChangePwd:!!u.mustChangePwd, createdAt:u.createdAt } }
function duty(u, name) { if (u.role !== 'admin' || !['all',name].includes(u.adminDuty || 'all')) fail('当前账号无此操作权限',403) }
function operate(u) { if (u.role === 'admin') duty(u,'operations') }
function finance(u) { if (u.role === 'admin') duty(u,'finance') }
function scopeOf(d) { return {projectId:id(d.projectId),accountId:id(d.accountId)} }
function belongs(row, scope) { if (!row || row.projectId !== scope.projectId || row.accountId !== scope.accountId) fail('记录不属于当前项目',404); return row }
module.exports = { Fault, fail, text, id, uid, clean, hash, cash, money, day, today, now, url, page, safeUser, duty, operate, finance, scopeOf, belongs }
