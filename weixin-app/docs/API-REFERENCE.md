# API Reference

微信小程序云函数 API 参考文档。

**当前覆盖：50 个接口。** 云端共注册 201 个处理器（用 `npm run cloud:check` 复核），本文档覆盖其中约 25%，其余接口待补充。

已收录：认证会话、项目成员、文件上传、报表导入、关键词、作品、财务、提现、单价、归因更正、运营管理、知乎联盟、历史兼容。

**待补充：** 其余约 150 个接口，以及每个接口的权限要求与错误码明细。未收录不等于未实现，也不等于行为已验收。

所有请求统一通过 `wx.cloud.callFunction` 调用 `opc-api`：

```javascript
const result = await wx.cloud.callFunction({
  name: 'opc-api',
  data: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: '/core/auth/login',
    token: 'access_token',  // 登录后携带
    data: {},               // 请求参数
    requestKey: 'unique-8-128-chars'  // 写操作必须携带
  }
})
```

**响应格式：**
```javascript
{
  statusCode: 200,
  code: 0,              // 0 表示成功
  data: {},             // 响应数据
  message: 'ok',
  requestId: 'uuid'
}
```

**错误码：**
- `401` - 未授权，需要重新登录
- `403` - 权限不足
- `409` - 冲突（测试模式/数据变化/需要重新核对）
- `410` - 接口已废弃
- `413` - 请求过大或超出批量限制
- `422` - 参数不正确
- `503` - 服务不可用（迁移未完成）

## 1. 认证和会话

### 1.1 登录

```
POST /core/auth/login
```

**请求：**
```typescript
{
  username: string
  password: string
}
```

**响应：**
```typescript
{
  token: string
  user: {
    id: string
    username: string
    role: 'creator' | 'leader' | 'admin'
    adminDuty?: 'operations' | 'finance' | 'all'
  }
  mustChangePwd: boolean
}
```

**说明：**
- 会话有效期 8 小时，绑定微信 OpenID
- 若 `mustChangePwd=true`，必须先修改密码才能进行其他操作

### 1.2 获取当前用户信息

```
GET /core/auth/me
```

**响应：**
```typescript
{
  id: string
  username: string
  role: 'creator' | 'leader' | 'admin'
  adminDuty?: 'operations' | 'finance' | 'all'
}
```

### 1.3 修改密码

```
POST /core/auth/change-password
```

**请求：**
```typescript
{
  oldPassword: string
  newPassword: string
}
```

### 1.4 登出

```
POST /core/auth/logout
```

## 2. 项目和成员

### 2.1 获取项目列表

```
GET /core/projects
```

**响应：**
```typescript
{
  projects: Array<{
    id: string
    name: string
    isEnabled: boolean
    role: 'creator' | 'leader' | 'admin'
  }>
}
```

### 2.2 获取项目成员

```
GET /core/projects/:id/members
```

**响应：**
```typescript
{
  members: Array<{
    userId: string
    username: string
    role: 'creator' | 'leader'
    joinedAt: string
  }>
}
```

### 2.3 获取项目集成账号

```
GET /core/projects/:id/integrations
```

**响应：**
```typescript
{
  integrations: Array<{
    id: string
    accountId: string
    platform: 'zhihu'
    status: 'active' | 'suspended'
  }>
}
```

### 2.4 创建项目成员

```
POST /core/projects/:id/members
```

**请求：**
```typescript
{
  userId: string
  role: 'creator' | 'leader'
  requestKey: string
}
```

**权限：** leader 或 admin

## 3. 文件上传

### 3.1 准备上传

```
POST /core/files/prepare
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  purpose: 'report' | 'payment-proof' | 'invoice' | 'alliance-xlsx'
  name: string  // 文件名，如 'report.xlsx'
}
```

**响应：**
```typescript
{
  id: string
  cloudPath: string  // 客户端直传路径（向后兼容）
  upload: {
    transport: 'cloud-function'
    chunkBytes: 524288      // 分片大小 512 KiB
    maxBytes: 10485760      // 最大文件大小
  }
}
```

**说明：**
- 报表最大 10 MiB
- 付款凭证和发票最大 5 MiB

### 3.2 上传分片

```
POST /core/files/:id/upload-chunk
```

**请求：**
```typescript
{
  index: number        // 分片序号，从 0 开始
  totalBytes: number   // 文件总大小
  base64: string       // 分片内容（Base64 编码）
}
```

**响应：**
```typescript
{
  id: string
  index: number
  received: true
}
```

**说明：**
- 每片最大 512 KiB（除最后一片）
- 同一序号可重试，内容必须相同
- 分片可乱序上传

### 3.3 完成上传

```
POST /core/files/:id/finish-upload
```

**请求：**
```typescript
{}
```

**响应：**
```typescript
{
  id: string
  complete: true
  size: number
  sha256: string
}
```

**说明：**
- 服务器合并分片并校验完整性
- 若返回 409，表示正在合并，等待 3 秒后重试
- 合并租约 90 秒

### 3.4 下载文件

```
GET /core/files/:id/download   ← ⚠️ 后端无此路由（2026-09-18 核实），文件下载请走各业务接口返回的短时链接
```

**响应：**
```typescript
{
  url: string    // 短时有效的下载链接
  name: string
}
```

## 4. 报表导入

### 4.1 创建导入任务（预览）

```
POST /modules/zhihu/imports
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  fileId: string           // 上传完成后的文件 ID
  reportKind?: string
}
```

**响应：**
```typescript
{
  id: string
  status: 'preview' | 'preparing'
  previewHash?: string
  preparedRows?: number
  rowCount?: number
  nextAction?: 'prepare'
}
```

**说明：**
- 若 `status='preparing'`，继续用同一 `fileId` 调用，直到 `status='preview'`
- 每 20 行保存解析进度

### 4.2 提交导入

```
POST /modules/zhihu/imports/:id/commit
```

**请求：**
```typescript
{
  previewHash: string    // 来自预览响应
  requestKey: string
}
```

**响应：**
```typescript
{
  id: string
  status: 'processing'
}
```

### 4.3 查询导入进度

```
GET /modules/zhihu/imports/:id
```

**响应：**
```typescript
{
  id: string
  status: 'processing' | 'completed' | 'failed'
  cursor: number        // 已处理行数
  rowCount: number      // 总行数
  error?: string
}
```

### 4.4 重试失败任务

```
POST /modules/zhihu/imports/:id/process
```

**说明：**
- 仅 `status='failed'` 时可用
- 继续处理剩余行

### 4.5 拒绝预览

```
POST /modules/zhihu/imports/:id/reject
```

**说明：**
- 仅 `status='preview'` 时可用

## 5. 关键词管理

### 5.1 获取关键词列表

```
GET /modules/zhihu/keywords
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  status?: 'available' | 'claimed' | 'bound'
}
```

**响应：**
```typescript
{
  keywords: Array<{
    id: string
    keyword: string
    status: 'available' | 'claimed' | 'bound'
    claimedBy?: string
    boundTo?: string
  }>
}
```

### 5.2 领取关键词

```
POST /modules/zhihu/keywords/:id/claim
```

**请求：**
```typescript
{
  requestKey: string
}
```

**权限：** creator

### 5.3 分配关键词

```
POST /modules/zhihu/keywords/:id/distribute
```

**请求：**
```typescript
{
  userId: string
  requestKey: string
}
```

**权限：** leader

### 5.4 激活关键词

```
POST /modules/zhihu/bindings/:id/activate
```

**请求：**
```typescript
{
  requestKey: string
}
```

## 6. 作品管理

### 6.1 获取作品列表

```
GET /modules/zhihu/evidence
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  status?: 'pending' | 'approved' | 'rejected'
}
```

### 6.2 提交作品

```
POST /modules/zhihu/evidence
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  bindingId: string
  url: string
  requestKey: string
}
```

### 6.3 审核作品

```
POST /modules/zhihu/evidence/:id/review
```

**请求：**
```typescript
{
  action: 'approve' | 'reject'
  comment?: string
  requestKey: string
}
```

**权限：** leader

## 7. 财务管理

### 7.1 获取钱包信息

```
GET /core/finance
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  moduleId: 'zhihu'
}
```

**响应：**
```typescript
{
  available: string    // 可提现金额（元，四位小数）
  held: string         // 冻结金额
  pending: string      // 待确认金额
}
```

### 7.2 获取财务工作台

```
GET /modules/zhihu/workbench
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  from: string         // YYYY-MM-DD
  to: string
  factIds?: string[]   // 可选，指定来源
}
```

**响应：**
```typescript
{
  period: { from: string, to: string }
  entries: Array<{
    id: string
    factId: string
    payeeId: string
    payeeName: string
    date: string
    amount: string
    status: 'draft' | 'confirmed'
    ready: boolean
    blocked: string
    // ...
  }>
  groups: Array<{ payeeId, name, confirmed, pending, total, blockers, ready }>
  reviewHash: string
  summary: { records, orders, issues, receivable, payable, ... }
}
```

> `reviewHash` 与请求里的 `factIds` 绑定：确认时必须带**完全相同**的 `factIds`，
> 否则后端重算后判为「数据已变化」返回 409。

### 7.3 确认财务

```
POST /modules/zhihu/workbench/confirm
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  from: string
  to: string
  factIds: string[]      // 与 GET 请求完全一致
  reviewHash: string     // 来自 GET 响应
  acknowledged: true
  requestKey: string
}
```

**权限：** admin(finance)

**说明：**
- 同一 `requestKey` 重试不会重复记账

### 7.4 获取待开放资金列表

```
GET /core/finance/funding-preview
```

**请求（第一页）：**
```typescript
{
  projectId: string
  accountId: string
  moduleId: 'zhihu'
}
```

**请求（后续页）：**
```typescript
{
  cursor: string       // 来自上一页响应
}
```

**响应：**
```typescript
{
  rows: Array<{
    id: string            // 候选行的收入记录 ID，提交时放进 incomeIds
    userId: string
    factId: string
    releaseAmount: string
  }>
  nextCursor?: string
  selectionRequired: true
  maxSelection: 3
}
```

> 带 `incomeIds` 再次请求同一路径时，额外返回本批 `amount` 与 `hash`。

### 7.5 选中收入获取哈希

```
GET /core/finance/funding-preview
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  moduleId: 'zhihu'
  incomeIds: string[]   // 1-3 个
}
```

**响应：**
```typescript
{
  amount: string
  hash: string
}
```

### 7.6 开放资金

```
POST /core/finance/funding
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  moduleId: 'zhihu'
  incomeIds: string[]
  hash: string          // 来自上一步
  reference: string
  requestKey: string
}
```

**权限：** admin(finance)

## 8. 提现管理

### 8.1 获取提现列表

```
GET /core/finance/withdrawals
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  moduleId: 'zhihu'
  status?: 'pending' | 'approved' | 'rejected' | 'paid'
}
```

### 8.2 申请提现

```
POST /core/finance/withdrawals
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  moduleId: 'zhihu'
  amount: string        // 元，最多四位小数
  requestKey: string
}
```

**响应：**
```typescript
{
  id: string
  status: 'pending'
}
```

### 8.3 审核提现

```
POST /core/finance/withdrawals/:id/review
```

**请求：**
```typescript
{
  action: 'approve' | 'reject'
  comment?: string
  requestKey: string
}
```

**权限：** leader

### 8.4 准备付款凭证上传

```
POST /core/finance/withdrawals/:id/proof/prepare
```

**请求：**
```typescript
{
  name: string
}
```

**响应：**
```typescript
{
  id: string
  upload: {
    transport: 'cloud-function'
    chunkBytes: 524288
    maxBytes: 5242880
  }
}
```

### 8.5 登记付款凭证

```
POST /core/finance/withdrawals/:id/proof
```

**请求：**
```typescript
{
  fileId: string
  requestKey: string
}
```

**权限：** admin(finance)

## 9. 单价管理

### 9.1 获取单价列表

```
GET /modules/zhihu/price-agreements
```

### 9.2 发布单价版本

```
POST /modules/zhihu/price-versions/:id/publish
```

**请求：**
```typescript
{
  requestKey: string
}
```

**权限：** leader

## 10. 归因和更正

### 10.1 获取归因列表

```
GET /modules/zhihu/attributions
```

**请求：**
```typescript
{
  projectId: string
  accountId: string
  from?: string
  to?: string
}
```

### 10.2 追踪归因

```
GET /modules/zhihu/attributions/:id/trace
```

### 10.3 重新计算归因

```
POST /modules/zhihu/attributions/:id/recompute
```

**请求：**
```typescript
{
  requestKey: string
}
```

### 10.4 解决指标修订

```
POST /modules/zhihu/metric-revisions/:id/resolve
```

**请求：**
```typescript
{
  action: 'accept' | 'reject'
  requestKey: string
}
```

## 11. 运营管理

### 11.1 获取公告

```
GET /core/announcements/active
```

**响应：**
```typescript
{
  announcements: Array<{
    id: string
    title: string
    content: string
    priority: 'high' | 'normal'
    publishedAt: string
  }>
}
```

### 11.2 获取审计日志

```
GET /core/audit-logs
```

**请求：**
```typescript
{
  projectId?: string
  action?: string
  from?: string
  to?: string
  limit?: number
}
```

**权限：** admin

### 11.3 审计清理

```
POST /core/admin-tools/audit-cleanup
```

**请求：**
```typescript
{
  cursor?: string      // 继续上次清理
  requestKey: string
}
```

**响应：**
```typescript
{
  cleaned: number
  nextCursor?: string
}
```

**权限：** admin(operations)

**说明：**
- 每次最多清理 25 条
- 财务、账单、单价、发票等审计保留

## 12. 知乎联盟接口

### 12.1 直接查询

```
GET /modules/zhihu/alliance/api/query
```

**请求：**
```typescript
{
  endpoint: string     // 知乎接口路径
  params: object
}
```

**权限：** admin(operations)

**说明：**
- 直接返回知乎结果
- 受每日配额限制

### 12.2 批量写入

```
POST /modules/zhihu/alliance/api/batch-write
```

**请求：**
```typescript
{
  fileId: string       // alliance-xlsx 文件
  requestKey: string
}
```

**响应：**
```typescript
{
  jobId: string
  status: 'queued'
}
```

**权限：** admin(operations)

### 12.3 查询作业状态

```
GET /modules/zhihu/jobs
```

**请求：**
```typescript
{
  jobId?: string
  status?: 'pending' | 'running' | 'completed' | 'failed'
}
```

## 13. 历史业务（兼容）

### 13.1 历史收益

```
GET /modules/zhihu/earnings
```

**响应金额单位：** 分（cent）

### 13.2 历史提现

```
GET /modules/zhihu/withdrawals
```

**说明：**
- `amountUnit: 'cent'`
- 状态：`pending` → `leader_approved` → `approved/rejected`
- 不伪造为新钱包的 `paid` 状态

### 13.3 历史计划

```
GET /modules/zhihu/plans
```

**说明：**
- 迁入独立集合
- 保留原归属
- 不自动生成新关键词绑定

## 附录：请求键（requestKey）规范

**什么时候需要：**
- 所有 POST/PUT/PATCH/DELETE 写操作

**长度要求：**
- 8-128 位

**生成规则：**
- 同一操作遇到超时：复用原键
- 用户更改内容：换新键
- 不要为每次重试重新生成

**示例：**
```javascript
// 错误：每次重试都生成新键
const submit = async () => {
  await api.post('/path', { requestKey: generateKey() })  // ❌
}

// 正确：同一操作复用同一键
const requestKey = generateKey()
const submit = async () => {
  await api.post('/path', { requestKey })  // ✓
}

// 正确：内容变化时换键
const [key, setKey] = useState(generateKey())
const onChange = () => setKey(generateKey())
```

## 附录：错误处理

**401 未授权：**
```javascript
if (error.status === 401) {
  wx.removeStorageSync('zk_access_token')
  wx.removeStorageSync('zk_project_id')
  wx.reLaunch({ url: '/pages/login/index' })
}
```

**409 冲突：**
```javascript
if (error.status === 409) {
  // 显示提示，让用户重新核对数据
  wx.showModal({
    title: '数据已变化',
    content: error.message,
    confirmText: '重新加载'
  })
}
```

**413 请求过大：**
```javascript
if (error.status === 413) {
  // 分批处理或缩小范围
}
```

**503 服务不可用：**
```javascript
if (error.status === 503) {
  // 显示维护提示
}
```
