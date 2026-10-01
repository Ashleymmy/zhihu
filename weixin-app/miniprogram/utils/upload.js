const request = require('./request')

/**
 * 上传文件到云存储。
 *
 * 先向服务端申请，由服务端决定路径与用途；服务端返回
 * upload.transport === 'cloud-function' 时走云函数分片上传，
 * 否则回退到客户端直传（向后兼容）。
 *
 * @param {Object} scope - 作用域 {projectId, accountId}
 * @param {string} purpose - 用途：'report' | 'payment-proof' | 'alliance-xlsx'
 *                           发票（invoice）走提现专用接口，不从这里上传
 * @param {Function} guard - 返回 false 表示页面/项目已变化，立即中断
 * @returns {Promise<string>} 文件 ID
 */

// 512 KiB 分片：base64 后 699052 字符，加上 JSON 外壳仍在云端
// upload-chunk 的 720 KiB 请求上限内（见 cloudfunctions/opc-api/lib/api.js:19）。
const DEFAULT_CHUNK_BYTES = 512 * 1024
const REPORT_BYTES = 10 * 1024 * 1024
const PROOF_BYTES = 5 * 1024 * 1024
const CHUNK_ATTEMPTS = 3
const FINISH_ATTEMPTS = 5
const FINISH_LEASE_WAIT = 3000

// 必须与 cloudfunctions/opc-api/lib/file-relay.js 的 maxBytes() 保持一致。
// alliance-xlsx 与 report 同为 XLSX，上限 10 MiB。
const XLSX_PURPOSES = ['report', 'alliance-xlsx', 'composition-xlsx']

function contextChanged() {
  const error = new Error('页面或项目已变化，请重新操作')
  error.code = 'CONTEXT_CHANGED'
  return error
}
function isXlsx(purpose) {
  return XLSX_PURPOSES.indexOf(purpose) >= 0
}
function limitOf(purpose) {
  return purpose === "composition-xlsx" ? PROOF_BYTES : isXlsx(purpose) ? REPORT_BYTES : PROOF_BYTES
}
function limitTextOf(purpose) {
  return purpose === 'composition-xlsx' ? '作品表格最大 5 MB' : isXlsx(purpose) ? '报表最大 10 MB' : '付款凭证最大 5 MB'
}
function extensionsOf(purpose) {
  return isXlsx(purpose) ? ['xlsx'] : ['png', 'jpg', 'jpeg', 'pdf']
}
// 会话失效、登录过期或页面/项目已变化时必须立即停止：
// 继续重试只会把数据写到错误的项目。
function fatal(error) {
  if (!error) return false
  return error.code === 'CONTEXT_CHANGED' || error.code === 'SESSION_CHANGED' || error.status === 401
}
// 只有网络错误和 5xx 值得重试；409 是租约/合并冲突，等待后可恢复。
// 403/413/422/501 是确定性拒绝，重试不会改变结果。
function retryable(error) {
  if (error && error.code === 'MALFORMED_RESPONSE') return false
  const status = error && error.status
  if (!status) return true
  return status >= 500 || status === 409 || status === 408
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function upload(scope, purpose, guard = () => true) {
  const current = () => {
    if (!guard()) throw contextChanged()
  }

  current()
  request.initializeCloud()

  const chosen = await wx.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: extensionsOf(purpose)
  })

  const file = chosen.tempFiles && chosen.tempFiles[0]
  current()
  if (!file) throw new Error('尚未选择文件')

  const limit = limitOf(purpose)
  if (file.size > limit) throw new Error(limitTextOf(purpose))

  const prepared = await request.post('/core/files/prepare', Object.assign({}, scope, {
    purpose,
    name: file.name
  }))

  current()

  if (prepared.upload && prepared.upload.transport === 'cloud-function') {
    return await uploadViaCloudFunction(file, prepared.id, prepared.upload, current)
  }

  const uploaded = await wx.cloud.uploadFile({
    cloudPath: prepared.cloudPath,
    filePath: file.path
  })
  current()
  await request.post('/core/files/' + prepared.id + '/complete', { fileID: uploaded.fileID })
  return prepared.id
}

async function uploadViaCloudFunction(file, fileId, config, guard) {
  const chunkBytes = config.chunkBytes || DEFAULT_CHUNK_BYTES
  const fs = wx.getFileSystemManager()

  const content = await new Promise((resolve, reject) => {
    fs.readFile({
      filePath: file.path,
      success: result => resolve(result.data),
      fail: reject
    })
  })

  guard()

  const totalBytes = content.byteLength
  if (!totalBytes) throw new Error('文件内容为空')
  if (config.maxBytes && totalBytes > config.maxBytes) {
    throw new Error('文件大小超过限制 ' + Math.round(config.maxBytes / 1024 / 1024) + ' MB')
  }

  const totalChunks = Math.ceil(totalBytes / chunkBytes)

  for (let index = 0; index < totalChunks; index++) {
    guard()
    const start = index * chunkBytes
    const chunk = content.slice(start, Math.min(start + chunkBytes, totalBytes))
    await uploadChunk(fileId, index, totalBytes, wx.arrayBufferToBase64(chunk), guard)
  }

  guard()
  return await finishUpload(fileId, guard)
}

async function uploadChunk(fileId, index, totalBytes, base64, guard) {
  let lastError

  for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt++) {
    try {
      guard()
      await request.post('/core/files/' + fileId + '/upload-chunk', { index, totalBytes, base64 })
      return
    } catch (error) {
      lastError = error
      if (fatal(error) || !retryable(error) || attempt === CHUNK_ATTEMPTS) break
      await sleep(1000 * attempt)
    }
  }

  if (fatal(lastError)) throw lastError
  throw new Error('第 ' + (index + 1) + ' 片上传失败：' + describe(lastError))
}

async function finishUpload(fileId, guard) {
  let lastError

  for (let attempt = 1; attempt <= FINISH_ATTEMPTS; attempt++) {
    try {
      guard()
      const result = await request.post('/core/files/' + fileId + '/finish-upload', {})
      if (!result || typeof result.id !== 'string') {
        const error = new Error('云服务未返回文件标识')
        error.code = 'MALFORMED_RESPONSE'
        throw error
      }
      return result.id
    } catch (error) {
      lastError = error
      if (fatal(error)) break
      if (error.status === 409 && attempt < FINISH_ATTEMPTS) {
        // 服务端持有 90 秒合并租约，等它释放后重试。
        await sleep(FINISH_LEASE_WAIT)
        continue
      }
      if (!retryable(error) || attempt === FINISH_ATTEMPTS) break
      await sleep(2000 * attempt)
    }
  }

  if (fatal(lastError)) throw lastError
  throw new Error('文件合并失败：' + describe(lastError))
}

function describe(error) {
  return (error && error.message) || '未知错误'
}

module.exports = { upload }
