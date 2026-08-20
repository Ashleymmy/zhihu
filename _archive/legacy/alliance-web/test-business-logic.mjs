/**
 * 业务逻辑代码级验证
 * 不需要真实 API，验证枚举映射、校验函数、类型组合等纯逻辑。
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CryptoJS = require('./node_modules/crypto-js')

// ─── 极简测试框架 ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0, section = ''
function describe(name, fn) { section = name; console.log(`\n${name}`); fn() }
function it(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++ }
  catch(e) { console.log(`  ✗  ${name}\n       ${e.message}`); failed++ }
}
function expect(val) {
  return {
    toBe:      (exp)  => { if (val !== exp) throw new Error(`Expected:\n       ${JSON.stringify(exp)}\n       Got:\n       ${JSON.stringify(val)}`) },
    toEqual:   (exp)  => { if (JSON.stringify(val) !== JSON.stringify(exp)) throw new Error(`Expected:\n       ${JSON.stringify(exp)}\n       Got:\n       ${JSON.stringify(val)}`) },
    toContain: (item) => { if (!val.includes(item)) throw new Error(`Expected to contain ${JSON.stringify(item)}, got: ${JSON.stringify(val)}`) },
    toBeNull:  ()     => { if (val !== null) throw new Error(`Expected null, got: ${JSON.stringify(val)}`) },
    not: {
      toBe:      (exp) => { if (val === exp) throw new Error(`Expected NOT ${JSON.stringify(exp)}, but got it`) },
      toContain: (item)=> { if (val.includes(item)) throw new Error(`Expected NOT to contain ${JSON.stringify(item)}`) },
    },
  }
}

// ─── 复现 enums.ts ────────────────────────────────────────────────────────────
const MEDIA_TYPES = [
  'KOC视频号', 'KOC百家号', 'KOC抖音', 'KOC快手', 'KOC微博',
  'KOC小红书', 'KOC定向', 'KOC头条号', 'KOC哔哩哔哩', 'KOC公众号',
]
const CompositionType   = { Other: 0, ImageText: 1, Video: 2 }
const CompositionSubType = {
  RealShot:1, LivePhoto:2, Screenshot:3, Comic:4,
  StickerCommentary:5, RealPerson:6, CatMeme:7, ComicDrama:8, Relaxing:9, ScrollScreen:10,
  Other:11,
}
const VALID_SUB_TYPE_MAP = {
  [CompositionType.ImageText]: [1,2,3,4],
  [CompositionType.Video]:     [5,6,7,8,9,10],
  [CompositionType.Other]:     [11],
}
function isValidCompositionTypeCombo(type, subType) {
  return VALID_SUB_TYPE_MAP[type]?.includes(subType) ?? false
}
const AuditStatusResponse = { Reviewing:0, Violation:1, Normal:2 }
const AuditStatusQuery    = { Reviewing:1, Violation:2, Normal:3 }
function auditResponseToQuery(v) { return v + 1 }

// 复现 validateImageFile
const ALLOWED_IMAGE_TYPES = ['image/jpeg','image/png']
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
function validateImageFile(file) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return '只支持 jpeg / png 格式的图片'
  if (file.size > MAX_IMAGE_BYTES) return `图片不能超过 2 MB，当前 ${(file.size/1024/1024).toFixed(2)} MB`
  return null
}

// 复现 isValidUrl（ComicView）
function isValidUrl(url) {
  if (!url) return false
  try { const u = new URL(url); return u.protocol==='https:' || u.protocol==='http:' }
  catch { return false }
}

// 复现 signature.ts
const GLOBAL_SIGN_EXCLUDED_KEYS = ['offset','limit','file','image','second_channel_id','X-Requested-With','signature']
function buildSignatureWithTrace(params, secretKey) {
  const filtered = Object.entries(params).filter(([k]) => !GLOBAL_SIGN_EXCLUDED_KEYS.includes(k))
  filtered.sort(([a],[b]) => a.localeCompare(b,'en',{sensitivity:'variant'}))
  const kvStr     = filtered.map(([k,v]) => `${k}=${String(v)}`).join('&')
  const md5Str    = CryptoJS.MD5(kvStr).toString(CryptoJS.enc.Hex)
  const signature = CryptoJS.HmacSHA256(md5Str, secretKey).toString(CryptoJS.enc.Hex)
  return { kvStr, md5Str, signature }
}

// ─── § 1: 签名算法 Golden Vector ─────────────────────────────────────────────
describe('§ 签名算法（Golden Vector）', () => {
  const GOLDEN_PARAMS = {
    task_id:'1443567656205545123', channel_id:'1462106336904909960',
    content_url:'https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888',
    popularize_type:0, keyword:'这是一个测试关键词', timestamp:1672899103, access_token:'Db6j0Yq0eppBb',
  }
  const SECRET = 'a735eb11da74123074675fa3522a90d1'

  it('MD5 精确匹配官方值', () => {
    const { md5Str } = buildSignatureWithTrace(GOLDEN_PARAMS, SECRET)
    expect(md5Str).toBe('112f078ecdb75d76b38e4d9e661772bd')
  })
  it('HmacSHA256 精确匹配官方值', () => {
    const { signature } = buildSignatureWithTrace(GOLDEN_PARAMS, SECRET)
    expect(signature).toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('offset / limit 被正确排除（不参与签名）', () => {
    const withPaged = { ...GOLDEN_PARAMS, offset:0, limit:10 }
    expect(buildSignatureWithTrace(withPaged, SECRET).signature)
      .toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('second_channel_id 被正确排除（不参与签名）', () => {
    const with2nd = { ...GOLDEN_PARAMS, second_channel_id:'999' }
    expect(buildSignatureWithTrace(with2nd, SECRET).signature)
      .toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('file / image 被正确排除', () => {
    const withFiles = { ...GOLDEN_PARAMS, file:'data', image:'data' }
    expect(buildSignatureWithTrace(withFiles, SECRET).signature)
      .toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('X-Requested-With 被正确排除', () => {
    const withHeader = { ...GOLDEN_PARAMS, 'X-Requested-With':'openApi' }
    expect(buildSignatureWithTrace(withHeader, SECRET).signature)
      .toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('signature 旧值被排除（防止循环签名）', () => {
    const withOld = { ...GOLDEN_PARAMS, signature:'old_value' }
    expect(buildSignatureWithTrace(withOld, SECRET).signature)
      .toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('key 乱序不影响结果', () => {
    const shuffled = { timestamp:1672899103, keyword:'这是一个测试关键词',
      access_token:'Db6j0Yq0eppBb', task_id:'1443567656205545123',
      content_url:'https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888',
      popularize_type:0, channel_id:'1462106336904909960' }
    expect(buildSignatureWithTrace(shuffled, SECRET).signature)
      .toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('中文不 URL-encode，原样参与签名', () => {
    // 如果 encode 了，MD5 会不同
    const encodedKw = { ...GOLDEN_PARAMS, keyword: encodeURIComponent('这是一个测试关键词') }
    expect(buildSignatureWithTrace(encodedKw, SECRET).md5Str)
      .not.toBe('112f078ecdb75d76b38e4d9e661772bd')
  })
  it('大写 MD5 导致签名不同（证明必须小写）', () => {
    // 用大写 MD5 重算 HmacSHA256
    const { md5Str } = buildSignatureWithTrace(GOLDEN_PARAMS, SECRET)
    const wrongSig = CryptoJS.HmacSHA256(md5Str.toUpperCase(), SECRET).toString(CryptoJS.enc.Hex)
    expect(wrongSig).not.toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('secret_key 不同导致签名不同', () => {
    expect(buildSignatureWithTrace(GOLDEN_PARAMS, 'wrong-key').signature)
      .not.toBe('794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579')
  })
  it('签名为 64 位小写十六进制', () => {
    const { signature } = buildSignatureWithTrace(GOLDEN_PARAMS, SECRET)
    if (!/^[0-9a-f]{64}$/.test(signature)) throw new Error(`Not 64-char hex: ${signature}`)
  })
})

// ─── § 2: 枚举定义完整性 ────────────────────────────────────────────────────
describe('§ 枚举定义完整性', () => {
  it('MEDIA_TYPES 包含 10 种媒体类型', () => {
    expect(MEDIA_TYPES.length).toBe(10)
    expect(MEDIA_TYPES).toContain('KOC抖音')
    expect(MEDIA_TYPES).toContain('KOC小红书')
    expect(MEDIA_TYPES).toContain('KOC哔哩哔哩')
  })
  it('CompositionType 有且仅有 0/1/2（v2 取消了3）', () => {
    const vals = Object.values(CompositionType)
    expect(vals).toEqual([0,1,2])
    expect(vals).not.toContain(3)
  })
  it('CompositionSubType 有 11 个值（1–11）', () => {
    const vals = Object.values(CompositionSubType)
    expect(vals.length).toBe(11)
    for (let i=1;i<=11;i++) {
      if (!vals.includes(i)) throw new Error(`Missing sub_type ${i}`)
    }
  })
  it('AuditStatusQuery 取值为 1/2/3（请求参数）', () => {
    expect(AuditStatusQuery.Reviewing).toBe(1)
    expect(AuditStatusQuery.Violation).toBe(2)
    expect(AuditStatusQuery.Normal).toBe(3)
  })
  it('AuditStatusResponse 取值为 0/1/2（返回值）', () => {
    expect(AuditStatusResponse.Reviewing).toBe(0)
    expect(AuditStatusResponse.Violation).toBe(1)
    expect(AuditStatusResponse.Normal).toBe(2)
  })
  it('GLOBAL_SIGN_EXCLUDED_KEYS 共 7 个', () => {
    expect(GLOBAL_SIGN_EXCLUDED_KEYS.length).toBe(7)
    for (const k of ['offset','limit','file','image','second_channel_id','X-Requested-With','signature']) {
      expect(GLOBAL_SIGN_EXCLUDED_KEYS).toContain(k)
    }
  })
})

// ─── § 3: AuditStatus 映射（请求 ↔ 返回 差1）─────────────────────────────────
describe('§ AuditStatus 请求/返回 +1 映射', () => {
  it('Reviewing: 返回 0 → 请求传 1', () => {
    expect(auditResponseToQuery(AuditStatusResponse.Reviewing)).toBe(AuditStatusQuery.Reviewing)
  })
  it('Violation:  返回 1 → 请求传 2', () => {
    expect(auditResponseToQuery(AuditStatusResponse.Violation)).toBe(AuditStatusQuery.Violation)
  })
  it('Normal:     返回 2 → 请求传 3', () => {
    expect(auditResponseToQuery(AuditStatusResponse.Normal)).toBe(AuditStatusQuery.Normal)
  })
  it('所有返回值 +1 = 对应请求值', () => {
    for (const [k, rv] of Object.entries(AuditStatusResponse)) {
      const qv = AuditStatusQuery[k]
      if (auditResponseToQuery(rv) !== qv)
        throw new Error(`${k}: response=${rv}, query=${qv}, mapped=${auditResponseToQuery(rv)}`)
    }
  })
})

// ─── § 4: 作品类型组合合法性 ──────────────────────────────────────────────────
describe('§ isValidCompositionTypeCombo', () => {
  it('图文(1) + 实拍(1) 合法', () => { if (!isValidCompositionTypeCombo(1,1)) throw new Error() })
  it('图文(1) + live图(2) 合法', () => { if (!isValidCompositionTypeCombo(1,2)) throw new Error() })
  it('图文(1) + 截屏(3) 合法', () => { if (!isValidCompositionTypeCombo(1,3)) throw new Error() })
  it('图文(1) + 漫画(4) 合法', () => { if (!isValidCompositionTypeCombo(1,4)) throw new Error() })
  it('视频(2) + 表情包(5) 合法', () => { if (!isValidCompositionTypeCombo(2,5)) throw new Error() })
  it('视频(2) + 漫剧(8) 合法', () => { if (!isValidCompositionTypeCombo(2,8)) throw new Error() })
  it('视频(2) + 滚屏(10) 合法', () => { if (!isValidCompositionTypeCombo(2,10)) throw new Error() })
  it('其他(0) + 其他(11) 合法', () => { if (!isValidCompositionTypeCombo(0,11)) throw new Error() })
  it('图文(1) + 表情包(5) 非法（跨类型）', () => { if (isValidCompositionTypeCombo(1,5)) throw new Error() })
  it('视频(2) + 实拍(1) 非法（跨类型）', () => { if (isValidCompositionTypeCombo(2,1)) throw new Error() })
  it('其他(0) + 实拍(1) 非法（跨类型）', () => { if (isValidCompositionTypeCombo(0,1)) throw new Error() })
  it('图文(1) + 其他(11) 非法（其他专属 type=0）', () => { if (isValidCompositionTypeCombo(1,11)) throw new Error() })
  it('VALID_SUB_TYPE_MAP 覆盖全部 11 个子类型（不遗漏）', () => {
    const all = [...VALID_SUB_TYPE_MAP[0], ...VALID_SUB_TYPE_MAP[1], ...VALID_SUB_TYPE_MAP[2]]
    for (let i=1;i<=11;i++) {
      if (!all.includes(i)) throw new Error(`sub_type ${i} 未被任何 type 覆盖`)
    }
    if (new Set(all).size !== 11) throw new Error('存在重复 sub_type')
  })
})

// ─── § 5: 文件上传校验 ────────────────────────────────────────────────────────
describe('§ validateImageFile', () => {
  const makeFile = (type, sizeKB) => ({ type, size: sizeKB * 1024 })
  it('合法 jpeg, 1 MB → null（通过）', () => {
    expect(validateImageFile(makeFile('image/jpeg', 1024))).toBeNull()
  })
  it('合法 png, 2 MB 整（边界）→ null', () => {
    expect(validateImageFile(makeFile('image/png', 2048))).toBeNull()
  })
  it('超过 2 MB → 返回错误信息', () => {
    const err = validateImageFile(makeFile('image/jpeg', 2049))
    if (!err) throw new Error('Expected error, got null')
    if (!err.includes('2 MB')) throw new Error(`Message should mention 2 MB: ${err}`)
  })
  it('gif 格式 → 返回格式错误', () => {
    const err = validateImageFile(makeFile('image/gif', 100))
    if (!err) throw new Error('Expected error, got null')
  })
  it('webp 格式 → 返回格式错误', () => {
    const err = validateImageFile(makeFile('image/webp', 100))
    if (!err) throw new Error('Expected error, got null')
  })
  it('2 MB + 1 byte 超限', () => {
    const err = validateImageFile({ type:'image/jpeg', size: 2*1024*1024+1 })
    if (!err) throw new Error('Expected error for 2MB+1')
  })
})

// ─── § 6: isValidUrl（ComicView 抖音 URL 过滤）────────────────────────────────
describe('§ isValidUrl (漫剧抖音视频链接过滤)', () => {
  it('https:// 合法', () => { if (!isValidUrl('https://example.com/video')) throw new Error() })
  it('http:// 合法', ()  => { if (!isValidUrl('http://example.com/video')) throw new Error() })
  it('空字符串 → false',  () => { if (isValidUrl(''))        throw new Error() })
  it('null → false',      () => { if (isValidUrl(null))       throw new Error() })
  it('"httsp://" 官方示例错误值 → false', () => {
    if (isValidUrl('httsp://')) throw new Error('官方文档提到 douyin_video_url 示例为 httsp:// 应被过滤')
  })
  it('无协议头 → false', () => { if (isValidUrl('example.com')) throw new Error() })
  it('ftp:// → false',   () => { if (isValidUrl('ftp://file')) throw new Error() })
})

// ─── § 7: 签名排除键 ─────────────────────────────────────────────────────────
describe('§ 签名排除键精确性（附录 B #5 边界）', () => {
  const params = {
    access_token:'tok', timestamp:1000, channel_id:'ch',
    keyword:'kw',
    // 以下全部应被排除
    offset:0, limit:10, file:'f', image:'i',
    second_channel_id:'sc', 'X-Requested-With':'openApi', signature:'old',
  }
  it('排除字段不影响结果（同等价于不传）', () => {
    const clean = { access_token:'tok', timestamp:1000, channel_id:'ch', keyword:'kw' }
    const s1 = buildSignatureWithTrace(params, 'secret').signature
    const s2 = buildSignatureWithTrace(clean, 'secret').signature
    expect(s1).toBe(s2)
  })
  it('空字符串值的非排除参数参与签名', () => {
    const withEmpty = { access_token:'tok', timestamp:1000, keyword:'' }
    const withoutEmpty = { access_token:'tok', timestamp:1000 }
    const s1 = buildSignatureWithTrace(withEmpty, 'secret').signature
    const s2 = buildSignatureWithTrace(withoutEmpty, 'secret').signature
    // keyword='' 参与签名，所以两者不同
    expect(s1).not.toBe(s2)
  })
})

// ─── § 8: 毫秒级 timestamp 签名结果不同（S01 代码侧预验证）─────────────────────
describe('§ 秒级 vs 毫秒级 timestamp', () => {
  const base = { access_token:'tok', channel_id:'ch' }
  it('秒级和毫秒级 timestamp 产生不同签名（说明需传秒级）', () => {
    const sec  = { ...base, timestamp: 1672899103 }
    const msec = { ...base, timestamp: 1672899103000 }
    expect(buildSignatureWithTrace(sec, 'key').signature)
      .not.toBe(buildSignatureWithTrace(msec, 'key').signature)
  })
})

// ─── 汇总 ─────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`)
console.log(`  总计: ${passed} passed, ${failed} failed`)
console.log(`${'─'.repeat(60)}\n`)
if (failed > 0) process.exit(1)
