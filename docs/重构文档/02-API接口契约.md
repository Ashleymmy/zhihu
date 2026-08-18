# 02 · API 接口契约文档

> **文档状态**：v2 修订基线，待 OpenAPI 3.1 冻结（不代表全部已实现）
> **创建日期**：2026-08-16
> **依赖文档**：00-重构总体规划.md, 01-数据库设计.md
> **审核状态**：⏳ 待审核；资金链受 `D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6 生产 Gate 共同阻断

> [!IMPORTANT]
> **规范优先级**：本文 v2 决策 > 知乎联盟官方 OpenAPI V1.4.17 > 已冻结的项目 OpenAPI 3.1 > v1 草稿与历史示例。第 2.2 节及后续未标明完整 request / response / error schema 的路径只是候选 inventory，不能据此生成客户端或认定已实现。

**v2 不可回退决策**：

- 知乎联盟基址固定为 `https://open.zhihu.com/alliance/api`，签名字段为 `access_token`、`timestamp`、`signature`。
- 作品 v1 将于 **2026-08-25** 下线；新实现、迁移和容灾路径只允许作品 v2，禁止以 v1 作为 fallback。
- `/data_report/real_time_data` 只提供运营指标且存在延迟，**不是结算依据**。官方 V1.4.17 未披露收益结算 API；只有 `D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6 均通过，才可上线生产资金链，任一未关闭时保持禁用。
- `A-001-SPEC` 是目标 OpenAPI 3.1 冻结，`A-001-CONFORMANCE` 是已实施切片的 route/spec 与真实 BFF Contract Test 一致性；目标 operation 不得被写成已实现。
- 当前 `server` 与本契约的差异均是迁移项，不得把目标行为写成已实现事实。

---

## 目录

- [一、接口设计原则](#一接口设计原则)
- [二、接口架构总览](#二接口架构总览)
- [三、认证与鉴权](#三认证与鉴权)
- [四、Admin 专用接口](#四admin-专用接口)
- [五、团长专用接口](#五团长专用接口)
- [六、达人专用接口](#六达人专用接口)
- [七、知乎联盟 BFF Adapter](#七知乎联盟-bff-adapter)
- [八、数据中继接口](#八数据中继接口)
- [九、错误码规范](#九错误码规范)

---

## 一、接口设计原则

### 1.1 RESTful 设计规范

| 原则 | 说明 | 示例 |
|------|------|------|
| **资源导向** | URL 表示资源，HTTP 方法表示操作 | `GET /api/v1/admin/orders` |
| **版本控制** | API 版本号在 URL 中 | `/api/v1/*` |
| **复数命名** | 资源名称使用复数形式 | `/orders` 而非 `/order` |
| **嵌套资源** | 子资源通过嵌套表达层级关系 | `/users/{id}/orders` |
| **幂等性** | GET/PUT/DELETE 必须幂等 | 相同请求多次执行结果一致 |

### 1.2 HTTP 方法语义

| 方法 | 语义 | 幂等性 | 请求体 | 响应体 |
|------|------|--------|--------|--------|
| GET | 查询资源 | ✅ | 无 | 资源数据 |
| POST | 创建资源 | ❌ | 必需 | 新建资源 |
| PUT | 完整更新资源 | ✅ | 必需 | 更新后资源 |
| PATCH | 部分更新资源 | ❌ | 必需 | 更新后资源 |
| DELETE | 删除资源 | ✅ | 无 | 空或删除确认 |

### 1.3 统一响应格式

**成功响应**：
```typescript
interface ApiEnvelope<T> {
  code: 0;                    // 成功固定为 0
  message: string;
  data: T;                    // 业务数据
  meta?: PaginationMeta;      // 仅列表响应使用
  requestId: string;          // 必填链路追踪 ID
  timestamp: number;          // 服务器 Unix 毫秒时间戳
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}
```

**失败响应**：
```typescript
interface ErrorResponse {
  code: number;               // 稳定的非 0 错误码
  message: string;            // 错误消息（用户友好）
  details?: Record<string, string[]>; // 字段级错误（表单验证）
  requestId: string;
  timestamp: number;
}

type FinanceFailedGate =
  | 'D-001-DECISION'
  | 'D-001-READINESS'
  | 'P0-008'
  | 'M6';

interface FinanceGateRejectedErrorResponse extends ErrorResponse {
  code: 50310;
  failedGates: readonly [FinanceFailedGate, ...FinanceFailedGate[]];
}
```

`FinanceFailedGate` 是目标 OpenAPI 3.1 的唯一 string enum；`FinanceGateRejectedErrorResponse` 是 `code = 50310` 时必用的目标 Schema。此时 `failedGates` 必填、最少 1 项、`uniqueItems = true`，只可包含 `D-001-DECISION`、`D-001-READINESS`、P0-008、M6 中本次实际为 false 的精确子集，并固定按上述 enum 顺序升序输出。不得省略、重复、猜测补充或以聚合错误名替代列表；其他错误码不得伪造该字段。

列表响应固定为 `data: T[]` 与必填的顶层 `meta`：

```typescript
type PageResponse<T> = ApiEnvelope<T[]> & { meta: PaginationMeta };
```

所有 BFF JSON endpoint（包括 `/api/alliance/api/*`）使用同一 envelope；健康检查和二进制下载除外。官方的 `success` / `data` / `error` / `msg` 只允许出现在 upstream adapter 内部，必须转换为稳定 BFF code、camelCase DTO 和本契约 envelope，绝不原样透传。当前 `server/src/utils/response.ts` 缺 `requestId`、`timestamp` 与顶层 `meta`，属于迁移项。OpenAPI 3.1 冻结前，后文示例若与本节冲突一律以本节为准。

`50310` 的稳定错误名为 `FINANCE_GATE_BLOCKED`，不新增错误编号。服务端仅对生产结算/提现打款的 `D-001-DECISION`、`D-001-READINESS`、P0-008、M6 Gate 拒绝计算失败集合；审批级次、权限、版本或幂等冲突分别使用其既有 4xx 错误，不得混入 `failedGates`。每次 `50310` 拒绝不得创建 payment intent、支付流水、余额占用或任何生产资金状态写入，但必须追加恰好一条 `finance.gate_rejected` 审计事件，至少包含 `requestId`、资源类型/ID、操作者、`code = 50310` 与按响应原样保存的 `failedGates`。

**分页请求参数**：
```typescript
interface PaginationParams {
  page?: number;              // 页码，从 1 开始，默认 1
  pageSize?: number;          // 每页条数，默认 20，最大 100
  sortBy?: string;            // 必须命中各 operation 的字段 allowlist，不得直拼 SQL
  sortOrder?: 'asc' | 'desc'; // 排序方向，默认 desc
}
```

### 1.4 金额分层契约

- `unitPrice`、`rawAmount`、`originalAmount`、`discountAmount`、`sourceAmount`、`calculatedAmount`、`quantity` 等来源/计算中间值使用固定 **4 位**十进制字符串，格式为 `^-?\d+\.\d{4}$`；BFF、前端与队列禁止用 JavaScript `number` 做运算。
- 进入审批边界时，先汇总精确 `calculatedAmount`，再按 `HALF_UP` 舍入为整数分；审批后的应付、结算、提现、退款和支付字段统一命名 `*AmountFen`，JSON 中必须是安全整数，数据库使用 `BIGINT`。
- 每次转换必须保存 `calculatedAmount`、`amountFen`、`roundingMode='HALF_UP'`、`roundingDelta` 与操作者/规则版本；舍入差额进入审计与对账，禁止静默丢弃或用浮点补差。

### 1.5 角色路由隔离

```
/api/v1/admin/*     → Admin 专用接口（需要 admin 角色）
/api/v1/leader/*    → 团长专用接口（需要 leader 角色）
/api/v1/creator/*   → 达人专用接口（需要 creator 角色）
/api/v1/common/*    → 公共接口（所有角色可访问）
/api/alliance/api/* → 知乎联盟 BFF adapter（需要知乎联盟权限）
```

**路由中间件链**：
```typescript
// 所有受保护接口
app.use('/api/v1/*', authMiddleware);      // JWT 验证
app.use('/api/v1/*', rbacMiddleware);      // 角色权限验证
app.use('/api/v1/*', rateLimitMiddleware); // 限流

// 联盟代理还必须依次执行：
// JWT → RBAC/permission → method+path allowlist → quota budget reservation
// → upload limits/MIME sniffing → audit(redacted) → 官方签名 → upstream
```

`/api/alliance/api/*` 不是开放式通配代理。每个允许的 `method + normalized path` 都必须在版本化 allowlist 中登记 request schema、权限、官方配额成本、超时、响应类型和上传策略；未知路径、路径穿越、重复编码和未登记 HTTP 方法一律拒绝。账号级日配额由本地 quota budget 预留并与官方响应对账，不能只做每 IP 限流。

上传基线：默认拒绝文件；允许上传的 endpoint 最多 1 个文件、默认上限 10 MiB，并取本地配置与官方上限中的更小值；只接受 `.xlsx` 且须同时通过扩展名、MIME（`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`）和 ZIP/XLSX 文件头检测。文件名、Token、签名及完整表格内容不得进入日志。

所有项目域 operation 必须声明 `X-Project-Id`（或在冻结规范中改为显式 path parameter），服务端再通过 `project_members` 解析范围；该值只是选择上下文，不授予权限。最终 repository SQL、缓存 key、队列 payload、导出和 WebSocket subscription 都必须同时携带已验证的 `project_id` 与 `user_id` 范围。

当前 `server` 使用 `boss/leader/member`，目标契约使用 `admin/leader/creator`。迁移必须显式执行 `boss → admin`、`member → creator` 映射并撤销旧 Token；禁止在同一发布版本中隐式接受两套角色名。

---

## 二、接口架构总览

### 2.1 接口分类与数量

第 2.2 节当前约有 **161 个候选 operation**。这个数字来自人工 inventory，是 `A-001-SPEC` 冻结前的目标候选数，不是已实现数量，也不是发布契约数量；已实施 operation 数必须由实现注册表和运行时 route inventory 单独生成。部分路径只有名称，没有完整 request / response / error、权限和幂等定义。当前 `server` 的实际 Express routes 明显少于该 inventory。

| Feature ID | 模块 | v2 处理方式 | 冻结前状态 |
|------------|------|-------------|-----------|
| `CORE-001` / `ACCOUNT-001` / `PROJECT-001` | 认证、用户、MCN、项目 | 对齐现有实现并补 session/family 与项目隔离 | 待补全 schema |
| `PROMO-001～003` | 推广计划、作品、联盟代理 | 以官方 V1.4.17 校正；作品仅 v2 | 高优先级冻结 |
| `PROMO-001～003`（指标侧） | 运营指标 | 与结算彻底隔离 | 待补数据口径 |
| `FIN-001` / `RELAY-001` / `SETTLE-001` | 来源批次、收益账本、结算、提现 | 受 `D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6 阻断 | 禁止上线 |
| `ORDER-001` | 订单与退款 | 冻结三角色权限、状态机、并发版本和退款资源 | 候选设计 |
| `UX-001` / `NOTIFY-001` | 创意工具、看板、系统管理、WebSocket | 按真实需求逐项保留或删除 | 候选设计 |

**`A-001` Gate 总称**：由两个不可互相替代的子 Gate 构成。

**`A-001-SPEC`（M0 目标契约冻结）**：每个保留 operation 必须具有唯一 `operationId`、认证与 scope、path/query/header/body Schema、成功与全部错误响应、幂等约束、审计字段和稳定 Test ID；目标 OpenAPI 3.1 通过 lint 与 breaking-change 检查后，才允许发布目标契约版本和目标 operation 数。该 Gate 不要求未来所有 operation 已有真实 route，也不证明任何功能已 implemented。

**`A-001-CONFORMANCE`（已实施切片一致性）**：只对已声明 implemented 的 operation 计算；必须证明实际 route 无未登记项、runtime spec 没有不存在的 implemented operation、Mock 与真实 BFF 共用同一 Schema，并通过真实 BFF Contract Test。按里程碑逐片关闭，M6 汇总全部 Required implementation 为 100%；legacy 路由必须登记为 `legacy/deprecated`，不能因目标已登记而冒充实现。

**路由注册硬规则**：同一 Router 内的固定路径（如 `/batch`、`/export`、`/stats`、`/enums`）必须在 `/:id` 之前注册，并用回归测试证明不会被动态参数吞掉。下方 inventory 按业务阅读顺序排列，不代表代码注册顺序。

### 2.2 接口 URL 规划

#### Admin 接口

```
# 用户管理
GET    /api/v1/admin/users                    # 用户列表
POST   /api/v1/admin/users                    # 创建用户
GET    /api/v1/admin/users/:id                # 用户详情
PUT    /api/v1/admin/users/:id                # 更新用户
DELETE /api/v1/admin/users/:id                # 删除用户
POST   /api/v1/admin/users/:id/reset-password # 重置密码
POST   /api/v1/admin/users/:id/ban            # 封禁用户
POST   /api/v1/admin/users/:id/unban          # 解封用户

# 订单管理
GET    /api/v1/admin/orders                   # 订单列表
POST   /api/v1/admin/orders                   # 创建订单
GET    /api/v1/admin/orders/:id               # 订单详情
PATCH  /api/v1/admin/orders/:id               # 仅 draft 更新来源字段；不可写派生金额或状态
DELETE /api/v1/admin/orders/:id               # 仅 draft/cancelled 可软删除
POST   /api/v1/admin/orders/:id/submit        # draft → pending
POST   /api/v1/admin/orders/:id/activate      # pending → active；Admin 金额审批边界
POST   /api/v1/admin/orders/:id/complete      # active → completed
POST   /api/v1/admin/orders/:id/settle        # completed → settled；受 D-001-DECISION、D-001-READINESS、P0-008 与 M6 阻断
POST   /api/v1/admin/orders/:id/refunds       # 创建退款资源（带 Idempotency-Key）
GET    /api/v1/admin/orders/:id/refunds       # 退款记录
POST   /api/v1/admin/orders/:id/cancel        # 取消订单
DELETE /api/v1/admin/orders/batch             # 批量软删，仅 draft/cancelled
GET    /api/v1/admin/orders/export            # 导出订单
GET    /api/v1/admin/orders/stats             # 订单统计

# 结算管理
GET    /api/v1/admin/settlements              # 结算单列表
POST   /api/v1/admin/settlements              # 创建结算单
GET    /api/v1/admin/settlements/:id          # 结算单详情
PUT    /api/v1/admin/settlements/:id          # 更新结算单
DELETE /api/v1/admin/settlements/:id          # 仅软删无审批/支付事实的 draft
POST   /api/v1/admin/settlements/:id/approve  # 只完成当前审批级
POST   /api/v1/admin/settlements/:id/reject   # 驳回当前审批级
POST   /api/v1/admin/settlements/:id/pay      # 创建幂等打款意图，不能直接标记成功
POST   /api/v1/admin/settlements/generate     # 批量生成结算单
GET    /api/v1/admin/settlements/export       # 导出结算单
DELETE /api/v1/admin/settlements/batch        # 批量软删，每项适用同一事实 Gate
GET    /api/v1/admin/settlements/stats        # 结算统计

# 提现管理
GET    /api/v1/admin/withdrawals              # 提现工单列表
GET    /api/v1/admin/withdrawals/:id          # 提现工单详情
POST   /api/v1/admin/withdrawals/:id/approve  # 只完成当前审批级
POST   /api/v1/admin/withdrawals/:id/reject   # 拒绝当前审批级
POST   /api/v1/admin/withdrawals/:id/pay      # 创建幂等打款意图，不能直接标记成功

# 推广管理
GET    /api/v1/admin/zhihu/tasks              # 知乎任务列表
POST   /api/v1/admin/zhihu/tasks              # 创建任务
GET    /api/v1/admin/zhihu/tasks/:id          # 任务详情
PUT    /api/v1/admin/zhihu/tasks/:id          # 更新任务
DELETE /api/v1/admin/zhihu/tasks/:id          # 删除任务

GET    /api/v1/admin/zhihu/plans              # 推广计划列表
POST   /api/v1/admin/zhihu/plans              # 创建计划
GET    /api/v1/admin/zhihu/plans/:id          # 计划详情
PATCH  /api/v1/admin/zhihu/plans/:id          # 仅本地草稿；已同步计划不得调用未披露的官方更新接口
DELETE /api/v1/admin/zhihu/plans/:id          # 删除计划
DELETE /api/v1/admin/zhihu/plans/batch        # 批量删除

GET    /api/v1/admin/zhihu/compositions       # 推广作品列表
POST   /api/v1/admin/zhihu/compositions       # 创建作品（仅官方 v2）
GET    /api/v1/admin/zhihu/compositions/:id   # 作品详情
DELETE /api/v1/admin/zhihu/compositions/:id   # 删除作品
DELETE /api/v1/admin/zhihu/compositions/batch # 批量删除

# 数据中继配置
GET    /api/v1/admin/relay/configs            # 中继配置列表
POST   /api/v1/admin/relay/configs            # 创建规则草稿/新版本
GET    /api/v1/admin/relay/configs/:id        # 配置详情
POST   /api/v1/admin/relay/configs/:id/publish # 发布不可变版本
POST   /api/v1/admin/relay/configs/:id/retire  # 停止后续匹配，不改历史

GET    /api/v1/admin/relay/ledger             # 账本分录（Admin，按项目过滤）
POST   /api/v1/admin/relay/revisions          # 追加冲正与替换分录

# 结算来源批次（D-001）
POST   /api/v1/admin/earning-source-batches                # 上传 XLSX 草稿批次
GET    /api/v1/admin/earning-source-batches/:id            # 批次与校验摘要
POST   /api/v1/admin/earning-source-batches/:id/validate   # 校验
POST   /api/v1/admin/earning-source-batches/:id/approve    # 独立 Admin 审批
POST   /api/v1/admin/earning-source-batches/:id/post       # 幂等入账

# 项目管理
GET    /api/v1/admin/projects                 # 项目列表
POST   /api/v1/admin/projects                 # 创建项目
GET    /api/v1/admin/projects/:id             # 项目详情
PUT    /api/v1/admin/projects/:id             # 更新项目
DELETE /api/v1/admin/projects/:id             # 删除项目
GET    /api/v1/admin/projects/:id/members     # 项目成员列表
POST   /api/v1/admin/projects/:id/members     # 添加成员
DELETE /api/v1/admin/projects/:id/members/:uid # 移除成员

# 创意工具配置
GET    /api/v1/admin/creative-tools           # 工具配置列表
POST   /api/v1/admin/creative-tools           # 创建工具配置
PUT    /api/v1/admin/creative-tools/:id       # 更新工具配置
DELETE /api/v1/admin/creative-tools/:id       # 删除工具配置
GET    /api/v1/admin/creative-tools/usage     # 工具使用统计

# 数据看板
GET    /api/v1/admin/dashboard/overview       # 总览数据
GET    /api/v1/admin/dashboard/earnings       # 收益趋势
GET    /api/v1/admin/dashboard/orders         # 订单趋势
GET    /api/v1/admin/dashboard/users          # 用户趋势
GET    /api/v1/admin/dashboard/top-leaders    # 团长排行
GET    /api/v1/admin/dashboard/top-creators   # 达人排行

# 系统管理
GET    /api/v1/admin/system/configs           # 系统配置列表
PUT    /api/v1/admin/system/configs/:key      # 更新配置
GET    /api/v1/admin/system/audit-logs        # 审计日志
GET    /api/v1/admin/roles                    # 角色列表
POST   /api/v1/admin/roles                    # 创建角色
GET    /api/v1/admin/permissions              # 权限列表
POST   /api/v1/admin/roles/:id/permissions    # 分配权限
```

#### 团长接口

```
# 用户管理
GET    /api/v1/leader/profile                 # 个人资料
PUT    /api/v1/leader/profile                 # 更新资料
GET    /api/v1/leader/creators                # 我的达人列表

# 订单管理
GET    /api/v1/leader/orders                  # 订单列表（我创建的+下级达人的）
POST   /api/v1/leader/orders                  # 创建订单
GET    /api/v1/leader/orders/:id              # 订单详情
PATCH  /api/v1/leader/orders/:id              # 仅授权范围内 draft 来源字段
POST   /api/v1/leader/orders/:id/submit       # 自己/下级范围 draft → pending
POST   /api/v1/leader/orders/:id/cancel       # 自己/下级范围 pending/active → cancelled
GET    /api/v1/leader/orders/stats            # 订单统计

# 结算管理
GET    /api/v1/leader/settlements             # 我的结算单列表
GET    /api/v1/leader/settlements/:id         # 结算单详情
GET    /api/v1/leader/settlements/stats       # 结算统计
GET    /api/v1/leader/creators/:id/settlements # 达人结算单列表

# 提现管理
GET    /api/v1/leader/withdrawals             # 我的提现工单
POST   /api/v1/leader/withdrawals             # 创建自己的提现草稿并冻结审批策略
POST   /api/v1/leader/withdrawals/:id/submit  # 自己的 draft → pending_approval
GET    /api/v1/leader/withdrawals/:id         # 工单详情
DELETE /api/v1/leader/withdrawals/:id         # 仅申请人软删无事实的 draft/pending_approval

# 推广管理
GET    /api/v1/leader/zhihu/plans             # 推广计划列表（我的+达人的）
POST   /api/v1/leader/zhihu/plans             # 创建推广计划
GET    /api/v1/leader/zhihu/plans/:id         # 计划详情
DELETE /api/v1/leader/zhihu/plans/:id         # 删除计划

GET    /api/v1/leader/zhihu/compositions      # 推广作品列表
POST   /api/v1/leader/zhihu/compositions      # 创建作品（仅官方 v2）
GET    /api/v1/leader/zhihu/compositions/:id  # 作品详情
DELETE /api/v1/leader/zhihu/compositions/:id  # 删除作品

# 数据中继（只读）
GET    /api/v1/leader/earnings                # 我的收益列表（中继后）
GET    /api/v1/leader/earnings/stats          # 收益统计
GET    /api/v1/leader/creators/:id/earnings   # 达人收益列表

# 项目管理
GET    /api/v1/leader/projects                # 我参与的项目列表
GET    /api/v1/leader/projects/:id            # 项目详情
GET    /api/v1/leader/projects/:id/members    # 项目成员

# 创意工具
GET    /api/v1/leader/creative-tools          # 可用工具列表
POST   /api/v1/leader/creative-tools/:id/use  # 使用工具（Mock 付费）
GET    /api/v1/leader/creative-tools/usage    # 我的使用记录

# 数据看板
GET    /api/v1/leader/dashboard/overview      # 总览数据
GET    /api/v1/leader/dashboard/earnings      # 收益趋势
GET    /api/v1/leader/dashboard/creators      # 达人表现
```

#### 达人接口

```
# 用户管理
GET    /api/v1/creator/profile                # 个人资料
PUT    /api/v1/creator/profile                # 更新资料

# 订单管理（Creator 只读）
GET    /api/v1/creator/orders                 # 我的订单列表
GET    /api/v1/creator/orders/:id             # 订单详情
GET    /api/v1/creator/orders/stats           # 订单统计

# 结算管理
GET    /api/v1/creator/settlements            # 我的结算单列表
GET    /api/v1/creator/settlements/:id        # 结算单详情
GET    /api/v1/creator/settlements/stats      # 结算统计

# 提现管理
GET    /api/v1/creator/withdrawals            # 我的提现工单
POST   /api/v1/creator/withdrawals            # 创建自己的提现草稿并冻结审批策略
POST   /api/v1/creator/withdrawals/:id/submit # 自己的 draft → pending_approval
GET    /api/v1/creator/withdrawals/:id        # 工单详情
DELETE /api/v1/creator/withdrawals/:id        # 仅申请人软删无事实的 draft/pending_approval

# 推广管理
GET    /api/v1/creator/zhihu/plans            # 我的推广计划列表
POST   /api/v1/creator/zhihu/plans            # 创建推广计划
GET    /api/v1/creator/zhihu/plans/:id        # 计划详情
DELETE /api/v1/creator/zhihu/plans/:id        # 删除计划

GET    /api/v1/creator/zhihu/compositions     # 我的推广作品列表
POST   /api/v1/creator/zhihu/compositions     # 创建作品（仅官方 v2）
GET    /api/v1/creator/zhihu/compositions/:id # 作品详情
DELETE /api/v1/creator/zhihu/compositions/:id # 删除作品

# 数据中继（只读）
GET    /api/v1/creator/earnings               # 我的收益列表（二次分发后）
GET    /api/v1/creator/earnings/stats         # 收益统计

# 项目管理
GET    /api/v1/creator/projects               # 我参与的项目列表
GET    /api/v1/creator/projects/:id           # 项目详情

# 创意工具
GET    /api/v1/creator/creative-tools         # 可用工具列表
POST   /api/v1/creator/creative-tools/:id/use # 使用工具（Mock 付费）
GET    /api/v1/creator/creative-tools/usage   # 我的使用记录

# 数据看板
GET    /api/v1/creator/dashboard/overview     # 总览数据
GET    /api/v1/creator/dashboard/earnings     # 收益趋势
```

#### 公共接口

```
# 认证
POST   /api/v1/auth/login                     # 用户登录
POST   /api/v1/auth/logout                    # 用户登出
POST   /api/v1/auth/refresh                   # 刷新 Token
GET    /api/v1/auth/me                        # 获取当前用户信息
POST   /api/v1/auth/change-password           # 修改密码

# 元数据
GET    /api/v1/meta/enums                     # 枚举值列表
```

---

## 三、认证与鉴权

### 3.1 JWT Token 结构

**Access Token**（有效期 2 小时）：
```typescript
interface JwtPayload {
  sub: string;                // 用户 ID
  jti: string;                // Access Token 唯一 ID
  sessionId: string;          // 关联 token_sessions
  username: string;           // 用户名
  role: 'admin' | 'leader' | 'creator'; // 角色
  permissions: string[];      // 权限快照；高风险操作仍需服务端复核
  iat: number;                // 签发时间
  exp: number;                // 过期时间
}
```

**Refresh Token**（有效期 7 天）：
```typescript
interface RefreshTokenPayload {
  sub: string;                // 用户 ID
  tokenFamily: string;        // Token 家族 ID（用于撤销）
  jti: string;                // 对应 token_sessions.token_id
  iat: number;
  exp: number;
}
```

### 3.2 认证接口

#### 3.2.1 用户登录

**接口**：`POST /api/v1/auth/login`

**请求体**：
```typescript
interface LoginRequest {
  username: string;           // 用户名或邮箱
  password: string;           // 明文密码
  rememberMe?: boolean;       // 记住我（延长 Refresh Token 有效期到 30 天）
}
```

**响应体**：
```typescript
interface LoginData {
  accessToken: string;        // JWT Access Token
  expiresIn: number;          // Access Token 过期时间（秒）
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    nickname?: string;
    avatarUrl?: string;
  };
}

type LoginResponse = ApiEnvelope<LoginData>;
```

登录成功同时返回 `Set-Cookie: refresh_token=<token>; Secure; HttpOnly; SameSite=Lax; Path=/api/v1/auth`。Refresh Token 不得出现在 JSON、可被 JavaScript 读取的存储或日志中；`rememberMe` 只影响该 Cookie 与服务端 session 的有效期。

**错误码**：
- `40101`：用户名或密码错误
- `40303`：账户已被封禁
- `40302`：账户未激活

#### 3.2.2 刷新 Token

**接口**：`POST /api/v1/auth/refresh`

**请求体**：无。Refresh Token 只能从 `refresh_token` HttpOnly Cookie 读取；JSON body、query、Bearer header 中出现 Token 时拒绝请求。

**响应体**：
```typescript
interface RefreshData {
  accessToken: string;        // 新的 Access Token
  expiresIn: number;
}

type RefreshResponse = ApiEnvelope<RefreshData>;
```

刷新成功通过同属性的 `Set-Cookie` 原子轮换 Refresh Token；JSON 只返回新的 Access Token envelope。

**错误码**：
- `40102`：Refresh Token 无效或过期
- `40103`：Token 家族已被撤销

**Refresh Token 安全规则**：

- Cookie 固定使用 `Secure; HttpOnly; SameSite=Lax; Path=/api/v1/auth`；登录和刷新只通过 `Set-Cookie` 写入，logout 用同一 Path 过期 Cookie。
- 数据库只保存 Refresh Token 的 SHA-256 哈希，不保存原文；Token 原文只在 TLS `Set-Cookie` header 中出现一次，永不进入 JSON、浏览器 JavaScript 或日志。
- 每次刷新必须轮换 Refresh Token，并在事务内把旧 session 标记为已使用/撤销。
- 已轮换 Token 再次出现视为复用攻击，立即撤销整个 `tokenFamily`，并写入安全审计。
- logout 撤销当前 family；修改密码、封禁账户和管理员“登出全部设备”撤销该用户全部 family。
- Cookie 鉴权 endpoint 必须校验可信 `Origin`；若部署边界不能保证同站请求，再增加 CSRF Token，不能仅依赖 Cookie 属性。
- Access Token 的 `projectId` 或客户端 header 不能直接授予项目权限；每次请求仍需校验 `project_members`。

#### 3.2.3 获取当前用户

**接口**：`GET /api/v1/auth/me`

**请求头**：
```
Authorization: Bearer <accessToken>
```

**响应体**：
```typescript
interface MeData {
  id: string;
  username: string;
  email: string;
  phone?: string;
  role: string;
  nickname?: string;
  avatarUrl?: string;
  parentUserId?: string;      // 上级用户 ID
  zhihuChannelId?: string;    // 知乎渠道 ID
  status: string;
  createdAt: string;
  lastLoginAt?: string;
}

type MeResponse = ApiEnvelope<MeData>;
```

### 3.3 权限控制

**RBAC 中间件逻辑**：
```typescript
// server/src/middleware/rbac.middleware.ts
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user; // 由 authMiddleware 注入
    
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        code: 40300,
        message: '无权访问此资源',
        requestId: req.requestId,
        timestamp: Date.now(),
      });
    }
    
    next();
  };
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    
    const hasPermission = requiredPermissions.every(perm =>
      user.permissions.includes(perm)
    );
    
    if (!hasPermission) {
      return res.status(403).json({
        code: 40301,
        message: '缺少必要权限',
        requestId: req.requestId,
        timestamp: Date.now(),
      });
    }
    
    next();
  };
}
```

**使用示例**：
```typescript
// 只允许 Admin 访问
app.get('/api/v1/admin/users', requireRole('admin'), getUsersHandler);

// 允许 Admin 和 Leader 访问
app.get('/api/v1/common/stats', requireRole('admin', 'leader'), getStatsHandler);

// 需要特定权限
app.delete('/api/v1/admin/users/:id', requirePermission('user.delete'), deleteUserHandler);
```

---

## 四、Admin 专用接口

### 4.1 用户管理接口

#### 4.1.1 获取用户列表

**接口**：`GET /api/v1/admin/users`

**查询参数**：
```typescript
interface GetUsersParams extends PaginationParams {
  role?: 'admin' | 'leader' | 'creator'; // 按角色筛选
  status?: 'active' | 'inactive' | 'banned'; // 按状态筛选
  keyword?: string;           // 关键词搜索（用户名/邮箱/昵称）
  parentUserId?: string;      // 按上级用户筛选
  createdAtStart?: string;    // 创建时间开始（ISO 8601）
  createdAtEnd?: string;      // 创建时间结束
}
```

**响应体**：
```typescript
type GetUsersResponse = PageResponse<User>;

interface User {
  id: string;
  username: string;
  email: string;
  phone?: string;
  role: string;
  nickname?: string;
  avatarUrl?: string;
  parentUserId?: string;
  parentUserName?: string;    // 上级用户名（关联查询）
  zhihuChannelId?: string;
  status: string;
  emailVerifiedAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

#### 4.1.2 创建用户

**接口**：`POST /api/v1/admin/users`

**请求体**：
```typescript
interface CreateUserRequest {
  username: string;           // 用户名，唯一，3-50 字符
  email: string;              // 邮箱，唯一
  phone?: string;             // 手机号
  password: string;           // 密码，至少 8 字符
  roleId: string;             // 角色 ID
  nickname?: string;          // 昵称
  realName?: string;          // 真实姓名
  idCard?: string;            // 身份证号（加密存储）
  parentUserId?: string;      // 上级用户 ID（团长/达人必填）
  zhihuChannelId?: string;    // 知乎渠道 ID（团长/达人必填）
}
```

**响应体**：
```typescript
type CreateUserResponse = ApiEnvelope<User>;
```

**字段验证**：
- `username`：3-50 字符，字母数字下划线，唯一
- `email`：符合邮箱格式，唯一
- `password`：至少 8 字符，包含字母和数字
- `phone`：符合中国手机号格式（可选）
- `idCard`：18 位身份证号（可选）

**错误码**：
- `40001`：username 已存在
- `40002`：email 已存在
- `40003`：手机号已存在
- `40004`：上级用户不存在
- `40005`：角色不存在

#### 4.1.3 更新用户

**接口**：`PUT /api/v1/admin/users/:id`

**请求体**：
```typescript
interface UpdateUserRequest {
  email?: string;
  phone?: string;
  nickname?: string;
  realName?: string;
  idCard?: string;
  parentUserId?: string;
  zhihuChannelId?: string;
  status?: 'active' | 'inactive' | 'banned';
}
```

**响应体**：
```typescript
type UpdateUserResponse = ApiEnvelope<User>;
```

#### 4.1.4 删除用户（软删除）

**接口**：`DELETE /api/v1/admin/users/:id`

**响应体**：
```typescript
type DeleteUserResponse = ApiEnvelope<null>;
```

**业务规则**：
- 软删除，设置 `deleted_at` 时间戳
- 删除用户时，级联处理下级用户（团长删除时，达人变为孤立）
- Admin 角色不可删除自己
- 至少保留一个 Admin 用户

### 4.2 订单管理接口

**权限与状态机基线**：

| 当前状态 | 允许动作 | 下一状态 | 必需条件 |
|----------|----------|----------|----------|
| `draft` | 提交 | `pending` | Admin，或订单所属范围内 Leader |
| `pending` | 激活 | `active` | Admin + `order.activate`；重算精确草稿并生成审批后整数分 |
| `active` | 完成 | `completed` | Admin + 完成证据 + 幂等键 |
| `completed` | 结算 | `settled` | Admin + `order.settle`；只消费 `D-001-READINESS` 已批准批次，受 `D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6 阻断 |
| `pending` / `active` | 取消 | `cancelled` | Admin，或所属范围内 Leader + `order.cancel` |
| `settled` | 部分退款 | `partially_refunded` | Admin + `order.refund`；累计退款小于已结算金额 |
| `settled` / `partially_refunded` | 全额退款 | `refunded` | 累计退款等于已结算金额 |

`cancelled` 与 `refunded` 是终态。Creator 对订单只读；Leader 只能在本人/下级项目范围创建、编辑、提交或取消，不能删除、结算或退款；删除仅限 Admin 且订单状态必须为 `draft/cancelled`。通用 `PATCH order` 不得直接写 `status`；状态转换必须在数据库事务中校验当前状态、项目范围、资源归属、幂等键和 `version`，并发版本冲突返回 409。越权 ID 统一返回 404。

#### 4.2.1 获取订单列表

**接口**：`GET /api/v1/admin/orders`

**查询参数**：
```typescript
interface GetOrdersParams extends PaginationParams {
  orderType?: 'promotion' | 'course' | 'custom';
  status?: 'draft' | 'pending' | 'active' | 'completed' | 'settled' | 'cancelled' | 'partially_refunded' | 'refunded';
  buyerUserId?: string;       // 按买家筛选
  sellerUserId?: string;      // 按卖家筛选
  buyerRole?: 'leader' | 'creator'; // 按买家角色筛选
  createdAtStart?: string;    // 下单时间开始
  createdAtEnd?: string;      // 下单时间结束
  settledAtStart?: string;    // 结算时间开始
  settledAtEnd?: string;      // 结算时间结束
  keyword?: string;           // 关键词搜索（订单号）
}
```

**响应体**：
```typescript
type GetOrdersResponse = PageResponse<Order>;

interface Order {
  id: string;
  orderNo: string;
  orderType: string;
  buyerUserId: string;
  buyerUserName: string;      // 关联查询
  buyerRole: string;
  sellerUserId?: string;
  sellerUserName?: string;    // 关联查询
  originalAmount: string;     // 服务端汇总的明细小计，固定 4 位十进制字符串
  discountAmount: string;     // 固定 4 位十进制字符串
  calculatedAmount: string;   // 服务端计算，固定 4 位十进制字符串
  payableAmountFen?: number;  // 仅金额审批后出现，JSON 安全整数
  paymentAmountFen?: number;  // 仅支付渠道确认后出现
  refundedAmountFen?: number; // 仅有成功退款快照时出现
  roundingMode?: 'HALF_UP';
  roundingDelta?: string;     // 固定 4 位十进制字符串
  amountApprovedAt?: string;
  currency: string;
  status: string;
  paymentMethod?: string;
  settledAt?: string;
  remark?: string;
  items: OrderItem[];         // 订单明细
  createdAt: string;
  updatedAt: string;
}

interface OrderItem {
  id: string;
  itemType: string;
  itemId?: string;
  itemName: string;
  itemSpec?: string;
  rawAmount: string;          // 来源计价基数/数量，固定 4 位十进制字符串
  unitPrice: string;          // 固定 4 位十进制字符串
  calculatedAmount: string;   // 服务端精确计算，客户端不得提交
}
```

#### 4.2.2 创建订单

**接口**：`POST /api/v1/admin/orders`

**请求体**：
```typescript
interface CreateOrderRequest {
  orderType: 'promotion' | 'course' | 'custom';
  buyerUserId: string;        // 买家用户 ID
  sellerUserId?: string;      // 卖家用户 ID（可选）
  items: {
    itemType: string;
    itemId?: string;
    itemName: string;
    itemSpec?: string;
    rawAmount: string;        // 固定 4 位十进制字符串，>= 0
    unitPrice: string;        // 固定 4 位十进制字符串，>= 0
  }[];
  discountAmount?: string;    // 固定 4 位十进制字符串，>= 0
  remark?: string;            // 备注
}
```

**响应体**：
```typescript
type CreateOrderResponse = ApiEnvelope<Order>;
```

**业务逻辑**：
1. 验证买家、卖家和项目成员范围；`rawAmount/unitPrice/discountAmount` 必须命中固定 4 位十进制格式并且非负。
2. 使用精确十进制库逐项生成 `item.calculatedAmount`，再由服务端汇总 `originalAmount` 并计算订单 `calculatedAmount = originalAmount - discountAmount`；禁止 JavaScript 浮点运算。
3. 请求 schema 必须拒绝客户端提交 `calculatedAmount`、任意 `*AmountFen`、`roundingMode` 或 `roundingDelta`，不能用未知字段剥离掩盖覆盖尝试。
4. 生成订单号：`ORD{YYYYMMDD}{6位随机数}`。创建响应是 `draft`，只返回固定 4 位来源/计算字符串，不包含任何 `*AmountFen`。
5. `POST /:id/submit` 只锁定草稿并进入 `pending`。Admin 调用 `POST /:id/activate` 时，服务端在事务内从明细重新计算；一致后才生成 `payableAmountFen = HALF_UP(calculatedAmount × 100)`，并记录固定 4 位 `roundingDelta = payableAmountFen / 100 - calculatedAmount`、操作者、时间、`requestId` 和规则快照。
6. 审批结果必须通过 `Number.isSafeInteger`；超范围拒绝激活。后续 `paymentAmountFen/refundedAmountFen` 只能消费审批快照，不能反向覆盖 `originalAmount/calculatedAmount` 或明细来源。

草稿更新接口遵守同一输入 schema；`pending` 之后禁止修改来源金额，退回修改必须生成新草稿版本并重新提交审批。

#### 4.2.3 创建退款资源

**接口**：`POST /api/v1/admin/orders/:id/refunds`

**请求头**：`Idempotency-Key: <非空唯一键>`

**请求体**：
```typescript
interface RefundOrderRequest {
  refundAmountFen?: number;   // JSON 安全整数，默认剩余可退金额
  refundReason: string;       // 退款原因
}
```

`refundAmountFen` 是订单已审批且支付成功后的退款指令，不属于草稿计算输入；它只能出现在退款 endpoint，必须小于等于服务端支付快照的剩余可退整数分，订单 create/PATCH 出现该字段时直接拒绝。

**响应体**：
```typescript
type RefundOrderResponse = ApiEnvelope<Refund>;
```

**业务逻辑**：
1. 锁定订单并验证 `project_id`、Admin `order.refund` 权限，以及状态为 `settled/partially_refunded`。
2. 以 `(order_id, Idempotency-Key)` 幂等创建 `refunds`，累计成功退款不得超过实付金额。
3. 支付渠道确认成功后，追加 `refund_ledger` 分录；原订单金额、历史退款和财务分录不得覆盖。
4. 根据累计成功退款更新订单状态快照为 `partially_refunded` 或 `refunded`，并记录审计。
5. 退款失败保留退款资源及失败原因；重试不得生成第二笔重复退款。

`Refund` 至少包含：`id`、`orderId`、`projectId`、`amountFen`、`currency`、`status`、`reason`、`paymentRefundId`、`createdBy`、`createdAt`。退款列表使用 `GET /api/v1/admin/orders/:id/refunds`，不能只在订单上保存一个退款合计字段。

#### 4.2.4 批量删除订单

**接口**：`DELETE /api/v1/admin/orders/batch`

**请求体**：
```typescript
interface BatchDeleteOrdersRequest {
  orderIds: string[];         // 订单 ID 列表，最多 100 个
}
```

**响应体**：
```typescript
type BatchDeleteOrdersResponse = ApiEnvelope<{
    successCount: number;
    failedCount: number;
    failedIds: string[];
}>;
```

### 4.3 结算、提现与打款 Gate（`SETTLE-001`）

结算只能消费在 `D-001-READINESS` 中验收的已批准来源批次及已复核的 `earnings_ledger` 分录；`D-001-DECISION` 决定其权威来源和字段口径。创建结算单时冻结 `approvalPolicyVersion` 与 `requiredApprovalLevels`；`POST /settlements/:id/approve` 每次只完成当前审批级，只有最后一级通过后才进入 `approved`。上传批次者、结算申请人不得审批自己的记录，同一审批人不得占用策略要求的两个独立级别。生产结算、余额、提现和打款只有在 `D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6 均通过时才可启用。

提现使用同一审批语义，但以独立的 `withdrawal_approvals` 不可变事实表留痕：创建草稿即冻结 `approvalPolicyVersion` 与 `requiredApprovalLevels`，并初始化乐观锁 `version`；默认 Level 1 为业务复核、Level 2 为财务批准。`POST /api/v1/admin/withdrawals/:id/approve` 只允许处理 `currentApprovalLevel + 1`，每次请求必须携带 `Idempotency-Key` 与当前 `version`；事务须验证策略版本、项目成员及级别权限，再追加审批事实并原子递增状态快照。申请人及该工单所消费账本分录关联来源批次的上传人不得审批；同一审批人不得占两个级别。只有最后一级通过后才能从 `pending_approval` 进入 `approved`，任一级拒绝均进入 `rejected`；需要修改时必须新建工单或业务修订版本，重新完成全部级别，不得覆盖旧审批事实。

提现资金分摊到 `earnings_ledger` 的不可变关联尚未冻结；该 P0-008 目标对象、关联和可追溯到 `source_batches.uploaded_by` 的约束属于 `A-001-SPEC`。实现后的 route/spec、migration 与运行时一致性属于 `A-001-CONFORMANCE` 和后续迁移验收；`D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6 任一未关闭时，生产提现审批和打款 endpoint 必须 fail closed，不能用角色检查替代来源职责分离。

结算与提现的主状态链均为：`draft → pending_approval → approved → payment_pending → paid`，任一审批级可转 `rejected`；提现支付失败还可从 `payment_pending` 转为 `failed`。审批、提交打款和支付回调都要求 `Idempotency-Key`、行锁/等价原子条件、版本检查及不可变审批记录。

资金 DTO 的字段基线如下；列表和详情仍分别套 `PageResponse<T>` 与 `ApiEnvelope<T>`：

```typescript
interface SettlementMoney {
  calculatedAmount: string;   // 固定 4 位十进制字符串，审批前精确合计
  payableAmountFen: number;   // HALF_UP 后的 JSON 安全整数分
  roundingMode: 'HALF_UP';
  roundingDelta: string;      // 固定 4 位十进制字符串
  currency: string;
}

interface WithdrawalMoney {
  withdrawalAmountFen: number;
  feeAmountFen: number;
  paymentAmountFen: number;
  currency: string;
}

interface ApprovalProgress {
  approvalPolicyVersion: number;
  requiredApprovalLevels: number;
  currentApprovalLevel: number;
  version: number;             // 提现乐观锁版本；审批请求必须回传当前值
}

interface PaymentIntentData {
  paymentIntentId: string;
  paymentAmountFen: number;
  status: 'pending' | 'succeeded' | 'failed';
}
```

`Settlement` 必须包含 `SettlementMoney`；`Withdrawal` 必须包含 `WithdrawalMoney` 与 `ApprovalProgress`；打款意图和回调快照必须包含 `paymentAmountFen`。退款只使用 `amountFen/refundAmountFen`，禁止新增无单位的 `amount` 字段。

`POST /api/v1/admin/settlements/:id/pay` 与 `POST /api/v1/admin/withdrawals/:id/pay` 都只创建打款意图，不得直接标记成功；仅当 `D-001-DECISION`、`D-001-READINESS`、P0-008、全部审批级和 M6 生产 Gate 同时通过，且支付渠道以幂等流水确认成功后，才写 `paid`。四个 Gate 任一未通过时返回 `50310 FINANCE_GATE_BLOCKED`，`failedGates` 必须精确列出本次为 false 的非空、去重、稳定顺序子集；不得提供手工绕过参数。该拒绝不得创建 payment intent、支付流水、余额占用或生产资金状态写入，但必须追加恰好一条含 `requestId` 与相同 `failedGates` 的 `finance.gate_rejected` 审计事件。Leader/Creator 只能查询或申请本人授权范围内结算/提现，不能审批或打款。

`DELETE /api/v1/leader/withdrawals/:id` 与 `DELETE /api/v1/creator/withdrawals/:id` 只允许工单申请人删除自己的 `draft/pending_approval` 工单，并且服务端在同一事务中确认不存在 `withdrawal_approvals`、支付意图/回调或退款事实后仅写入 `deletedAt`。一旦有任一事实，返回冲突错误；Admin 不提供删除提现或其他财务事实的业务 endpoint，更不得物理删除。

---

## 五、团长专用接口

### 5.1 数据权限

团长接口的数据访问范围：
- **自己的数据**：订单、结算、提现、推广计划、收益
- **下级达人的数据**：可查看，部分可操作（如审批达人提现）

**行级权限实现**：
```typescript
// 最终 repository SQL 必须同时绑定项目与已授权用户集合
WHERE project_id = :authorizedProjectId
  AND buyer_user_id IN (:authorizedUserIds)
```

### 5.2 我的达人列表

**接口**：`GET /api/v1/leader/creators`

**查询参数**：
```typescript
interface GetCreatorsParams extends PaginationParams {
  status?: 'active' | 'inactive' | 'banned';
  keyword?: string;           // 关键词搜索
}
```

**响应体**：
```typescript
type GetCreatorsResponse = PageResponse<Creator>;

interface Creator {
  id: string;
  username: string;
  nickname?: string;
  avatarUrl?: string;
  zhihuChannelId?: string;
  status: string;
  totalCalculatedAmount: string; // 固定 4 位十进制字符串，未审批收益
  monthCalculatedAmount: string; // 固定 4 位十进制字符串，未审批收益
  activePlansCount: number;   // 活跃推广计划数
  createdAt: string;
  lastLoginAt?: string;
}
```

### 5.3 达人收益列表

**接口**：`GET /api/v1/leader/creators/:id/earnings`

**查询参数**：
```typescript
interface GetCreatorEarningsParams extends PaginationParams {
  earningDateStart?: string;  // 收益日期开始
  earningDateEnd?: string;    // 收益日期结束
  earningType?: string;       // 收益类型
}
```

**响应体**：
```typescript
type GetCreatorEarningsResponse = PageResponse<Earning>;

interface Earning {
  ledgerEntryId: string;
  earningDate: string;
  earningType: string;
  zhihuTaskId: string;
  zhihuChannelId?: string;
  zhihuCompositionId?: string;
  unitPrice: string;          // 固定 4 位十进制字符串
  quantity: string;           // 固定 4 位十进制字符串
  calculatedAmount: string;   // 固定 4 位十进制字符串，尚非 payable
  calculatedAt: string;
}
```

**业务规则**：
- 团长看到的是达人的收益数据（已经过二次分发计算）
- 不显示知乎原始单价和金额
- 仅显示该团长下级达人的数据

---

## 六、达人专用接口

### 6.1 数据权限

达人接口的数据访问范围：
- **仅自己的数据**：订单、结算、提现、推广计划、收益

**行级权限实现**：
```typescript
// 达人查询仍必须同时绑定 project_id 与本人 user_id
WHERE project_id = :authorizedProjectId AND user_id = :currentUserId
```

### 6.2 我的收益列表

**接口**：`GET /api/v1/creator/earnings`

**查询参数**：
```typescript
interface GetMyEarningsParams extends PaginationParams {
  earningDateStart?: string;
  earningDateEnd?: string;
  earningType?: string;
}
```

**响应体**：
```typescript
type GetMyEarningsResponse = PageResponse<Earning>;
```

**业务规则**：
- 达人看到的是二次分发后的收益数据
- 不显示知乎原始数据
- 不显示团长收益

---

## 七、知乎联盟 BFF Adapter

### 7.1 官方基线与 allowlist

**内部挂载路径**：`/api/alliance/api/*`  
**官方基址**：`https://open.zhihu.com/alliance/api`

以下是 V1.4.17 中与本项目直接相关的最小 allowlist；新增路径必须先完成官方逐字段核对和 OpenAPI 3.1 评审，不能依赖通配转发。

| Method | 官方 path | 请求类型 | v2 约束 |
|--------|-----------|----------|---------|
| `POST` | `/popularize_plan` | JSON | 单个创建推广计划 |
| `POST` | `/popularize_plans` | multipart XLSX | 批量创建推广计划；`X-Requested-With: openApi` |
| `POST` | `/popularize_composition/v2` | JSON | 单个创建作品，仅 v2 |
| `POST` | `/popularize_compositions/v2` | multipart XLSX | 批量创建作品，仅 v2；`X-Requested-With: openApi` |
| `PUT` | `/popularize_composition/v2/:composition_id` | JSON | 仅审核未通过作品可更新，仅 v2 |
| `GET` | `/popularize_compositions` | query | 查询作品列表；按官方字段 schema 签名 |
| `GET` | `/data_report/real_time_data` | query | 运营指标，约有 3-4 小时延迟，非结算依据 |

官方将 v2 作品列表定义在没有 `/v2` 后缀的 `/popularize_compositions`；它是 V1.4.17 的 v2 查询接口，不得因此替换成旧版创建/更新 path。

官方 V1.4.17 未披露推广计划更新 path，也未披露原始单价/收益结算 path；二者都必须 fail closed。作品旧版 path 自 **2026-08-25** 起禁止调用，迁移期间也不得作为 v2 失败后的 fallback。

### 7.2 签名、权限与配额

每次请求由服务端注入 `access_token`、秒级 `timestamp` 和 `signature`，密钥不得下发前端。参与签名的字段及排除项必须来自该 endpoint 的官方 schema：例如批量接口的 `file` 与 header 不参与签名，推广计划的 `second_channel_id` 不参与签名。禁止把 query/body 任意合并后直接签名，也禁止接受客户端提供的签名字段。

处理顺序固定为：

1. 规范化 method/path 并命中 allowlist。
2. 验证 JWT、RBAC、细粒度 permission 与 `project_id` 成员关系。
3. 用 request schema 删除未知字段，校验字段类型、长度和组合约束。
4. 预留账号级 quota budget；不足时本地返回 `429xx`，不请求官方。
5. 执行文件数量、字节数、扩展名、MIME 和文件头检查。
6. 服务端注入签名字段，调用固定官方 host；禁止用户可控 URL 或重定向逃逸。
7. 记录脱敏审计并回收/确认 quota；日志不得含 Token、签名、secret 或文件内容。

### 7.3 作品 v2 分类契约

v2 的 `composition_type` 与 `composition_sub_type` 均必填，并只接受下列合法父子组合：

| `composition_type` | 含义 | 允许的 `composition_sub_type` |
|--------------------|------|--------------------------------|
| `0` | 其他 | `11`（其他） |
| `1` | 图文 | `1`（实拍）、`2`（Live 图）、`3`（截屏）、`4`（漫画） |
| `2` | 视频 | `5`（表情包解说）、`6`（真人演绎）、`7`（猫 meme）、`8`（漫剧）、`9`（解压）、`10`（滚屏） |

校验必须同时用于单个创建、单个更新、批量文件逐行校验和异步重试；只做各字段数值范围校验不合格。官方同一版本的更新参数描述出现了额外一级分类文字，但其分类备注没有对应二级分类，v2 以“组合合法”表为准，不接受没有合法二级分类映射的值。`media_type` 也必须使用官方枚举，`release_time` 转成秒级时间戳前必须校验带时区的 ISO 8601 输入。

### 7.4 请求与响应示例

**BFF 客户端请求**：

```http
POST /api/alliance/api/popularize_plan
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "taskId": "123456",
  "channelId": "ch_abc",
  "contentUrl": "https://example.com/content",
  "popularizeType": 0,
  "keyword": "小说名"
}
```

客户端 DTO 只使用 camelCase。adapter 按 endpoint schema 把 allowlist 字段转换为 snake_case，再注入签名字段；客户端请求中出现 snake_case 未知字段或签名字段时直接拒绝。下面两段官方 JSON 都只是 **upstream adapter 输入**，不得返回 BFF 客户端。

官方成功输入：

```json
{
  "success": true,
  "msg": "创建成功",
  "data": {
    "plan_id": "1594363012301801254"
  }
}
```

官方业务错误输入：

```json
{
  "error": {
    "code": 400400,
    "name": "OpenApiParamError",
    "message": "timestamp 无效"
  }
}
```

adapter 将成功结果转换为 camelCase BFF envelope：

```json
{
  "code": 0,
  "message": "创建成功",
  "data": {
    "planId": "1594363012301801254"
  },
  "requestId": "req_01K2Q8Z6F7",
  "timestamp": 1700000000123
}
```

官方业务拒绝统一映射为稳定 BFF code；官方 code/name 仅写入脱敏审计，不得透传：

```json
{
  "code": 50300,
  "message": "知乎业务请求被拒绝",
  "requestId": "req_01K2Q8Z6F7",
  "timestamp": 1700000000123
}
```

连接失败、超时、DNS/TLS 错误等没有官方响应的 transport failure 返回：

```json
{
  "code": 50200,
  "message": "知乎服务暂时不可用",
  "requestId": "req_01K2Q8Z6F7",
  "timestamp": 1700000000123
}
```

不得把上游响应中的敏感字段、完整 body 或 stack trace 回显给客户端。

### 7.5 当前 `server` 迁移项

当前 `server/src/routes/alliance.ts` 仍使用 GET/POST/PUT 通配路由和内存上传，尚无 method+path allowlist、账号级 quota budget、完整审计及明确的文件大小/数量/MIME 限制；这些都是发布阻断项。现有 `project.manage` 单一权限不能替代 endpoint permission 与 `project_members` 隔离。

`server/src/jobs/pushPlan.ts` 当前会对已同步计划调用官方文档未披露的推广计划更新 path，v2 必须禁用该分支，直到新官方版本与契约测试证明可用。相对地，`pushComposition.ts` 已使用 `/popularize_composition/v2`，`src/zhihu/composition.ts` 也已有合法父子组合校验；迁移应保留并扩展到 batch/代理入口，不得退回旧版。

迁移完成须用允许路径、拒绝路径、配额耗尽、超限文件、伪造 MIME、路径编码、计划更新拒绝、作品 v2 单个/批量/更新及日志脱敏测试验收。

---

## 八、数据中继接口

### 8.1 `D-001-READINESS`：结算来源批次

官方 `/data_report/real_time_data` 不能调用本节任一入账 endpoint。`D-001-DECISION` 未关闭前，本节所有实际 source adapter、匿名样例导入、审批、中继与对账只能作为目标契约或 Mock，不能因标为沙箱而实施。只有 `D-001-DECISION` 关闭后，首个实际 source adapter 才可在隔离沙箱运行以积累 READINESS 证据；生产结算、余额、提现和打款仍须同时满足 `D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6。该首个隔离沙箱 source adapter 是 Admin XLSX：

1. `POST /api/v1/admin/earning-source-batches` 上传 1 个 XLSX，创建 `uploaded` 批次；要求 `earning-source.upload`。
2. `POST /:id/validate` 逐行校验 schema、非空 `sourceItemKey`、项目归属、重复键与金额合计，只能进入 `validated`。
3. 另一名 Admin 调用 `POST /:id/approve`；上传人不得审批自己的批次，要求 `earning-source.approve`。
4. `POST /:id/post` 使用批次稳定键幂等追加账本，要求 `earning-ledger.post`；成功后才标记 `posted`。

批次上传采用与第 1.4 节一致的文件防护，且 raw rows 只对有 `earning-source.read_raw` 权限的 Admin 可见。`D-001-DECISION` 仅以用户对权威来源、字段、周期、币种、修订与冲正规则的书面确认关闭；关闭前本节不得实施实际 adapter、匿名样例导入、审批、中继或对账。`D-001-READINESS` 仅以 `D-001-DECISION` 关闭后、隔离沙箱中的实际 adapter、匿名样例、审批、幂等、中继、冲正和对账证据关闭。本节的隔离沙箱闭环不放行生产资金；生产 pay endpoint 仍在 `D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6 任一未通过时返回 `50310 FINANCE_GATE_BLOCKED` 及精确 `failedGates`。

### 8.2 版本化中继配置

**接口**：`POST /api/v1/admin/relay/configs`

```typescript
interface CreateRelayConfigVersionRequest {
  projectId: string;          // 必填，不允许全局跨项目规则
  configGroupId?: string;     // 新版本时填写已有 group
  targetUserId?: string;      // 为空表示项目内该角色默认
  targetRole: 'leader' | 'creator';
  zhihuTaskId?: string;
  earningType: string;
  method: 'fixed' | 'percentage' | 'expression';
  unitPrice?: string;         // 固定 4 位十进制字符串；仅 fixed
  percentage?: string;        // 0..1 十进制字符串；仅 percentage
  expressionAst?: ExpressionAst; // 仅 expression，通过版本化 schema
  effectiveFrom: string;      // 带时区 ISO 8601
  effectiveTo?: string;
  priority?: number;
}
```

创建只产生 `draft` 版本；`POST /api/v1/admin/relay/configs/:id/publish` 校验范围无歧义、时间不重叠、数值和 AST 安全后发布。published 版本不得修改或删除；`retire` 只终止未来匹配。金额参数使用十进制字符串，服务端用 DECIMAL/decimal library 计算，禁止 JavaScript `number` 财务运算。

`expressionAst` 只允许常量、`source_amount`、`quantity`、四则运算、`min`、`max` 和显式舍入，并限制深度、节点数、除零和输出范围；拒绝源码字符串、动态函数、属性访问、循环和外部调用。

### 8.3 冲正与替换任务

**接口**：`POST /api/v1/admin/relay/revisions`  
**请求头**：`Idempotency-Key: <非空唯一键>`

```typescript
interface CreateLedgerRevisionRequest {
  projectId: string;
  replacementConfigId: string;
  dateStart: string;
  dateEnd: string;
  targetUserIds?: string[];
  reason: string;
  mode: 'preview' | 'post';
}

type CreateLedgerRevisionResponse = ApiEnvelope<{
    jobId: string;
    affectedEntryCount: number;
    reversalCalculatedAmount: string;   // 固定 4 位十进制字符串
    replacementCalculatedAmount: string; // 固定 4 位十进制字符串
}>;
```

`preview` 只返回影响范围和金额，不写账本；`post` 必须二次授权。任务对每条旧分录追加唯一 reversal，再追加使用新规则版本的 replacement accrual，绝不更新或删除历史 ledger entry。重放相同 `Idempotency-Key` 返回同一 job；范围中的所有用户必须属于请求者已授权的 `projectId`。

### 8.4 读取契约

- Admin 原始来源：同时检查 `projectId` 与 `earning-source.read_raw`。
- 团长/达人收益：只从 `earnings_ledger` 读取，并在最终查询同时绑定 `project_id` 与服务端计算的 `authorized_user_ids`。
- 响应不得返回来源金额、来源单价、raw payload、其他用户规则或其他项目聚合。
- 余额与结算额按账本有符号金额求和；缓存 key 必须包含 `project_id` 与 `user_id`，冲正后精确失效。

---

## 九、错误码规范

### 9.1 错误码分类

| 范围 | 类型 | 说明 |
|------|------|------|
| 0 | 成功 | 请求成功 |
| 40000-40099 | 请求错误 | 参数错误、格式错误 |
| 40100-40199 | 认证错误 | 登录失败、Token 无效 |
| 40300-40399 | 权限错误 | 无权访问、权限不足 |
| 40400-40499 | 资源错误 | 资源不存在 |
| 40900-40999 | 冲突错误 | 资源冲突、重复 |
| 42200-42299 | 语义校验 | 字段组合、状态转换不合法 |
| 42900-42999 | 限流错误 | 请求过于频繁 |
| 50000-50099 | 服务器错误 | 内部错误 |
| 50200-50299 | 上游传输错误 | 未收到知乎业务响应 |
| 50300-50399 | 上游业务/Gate | 上游业务拒绝或功能依赖未就绪 |

### 9.2 常用错误码

| 错误码 | 消息 | 说明 |
|--------|------|------|
| 0 | 成功 | 请求成功 |
| 40000 | 参数错误 | 请求参数格式或值错误 |
| 40001 | 用户名已存在 | 注册时用户名重复 |
| 40002 | 邮箱已存在 | 注册时邮箱重复 |
| 40101 | 用户名或密码错误 | 登录失败 |
| 40102 | Token 无效或过期 | JWT 验证失败 |
| 40103 | Token 家族已撤销 | Refresh Token 被撤销 |
| 40300 | 无权访问此资源 | 角色不匹配 |
| 40301 | 缺少必要权限 | 权限不足 |
| 40302 | 账户未激活 | 邮箱未验证 |
| 40303 | 账户已被封禁 | 用户被封禁 |
| 40400 | 资源不存在 | 查询的资源不存在 |
| 40401 | 用户不存在 | 用户 ID 无效 |
| 40402 | 订单不存在 | 订单 ID 无效 |
| 40900 | 资源已存在 | 创建重复资源 |
| 40910 | 幂等键冲突 | 同一键对应不同请求体 |
| 42210 | 作品分类组合不正确 | `composition_type` / `composition_sub_type` 不匹配 |
| 42220 | 状态转换不允许 | 订单、退款、批次或结算状态机拒绝 |
| 42900 | 请求过于频繁 | 触发限流 |
| 42910 | 知乎账号配额不足 | quota budget 无可用额度 |
| 50000 | 服务器内部错误 | 未捕获异常 |
| 50001 | 数据库错误 | 数据库操作失败 |
| 50200 | 知乎服务暂时不可用 | transport failure，未收到官方响应 |
| 50300 | 知乎业务请求被拒绝 | upstream business error；官方 code 仅进审计 |
| 50310 | `FINANCE_GATE_BLOCKED` | `D-001-DECISION`、`D-001-READINESS`、P0-008、M6 的任一子集未通过；响应必须给出非空、去重、稳定顺序的精确 `failedGates` |

### 9.3 错误响应示例

**参数验证错误**：
```json
{
  "code": 40000,
  "message": "参数验证失败",
  "details": {
    "username": ["用户名长度必须在 3-50 字符之间"],
    "email": ["邮箱格式不正确"]
  },
  "requestId": "req_01K2Q8Z6F7",
  "timestamp": 1700000000123
}
```

**权限错误**：
```json
{
  "code": 40300,
  "message": "无权访问此资源",
  "requestId": "req_01K2Q8Z6F7",
  "timestamp": 1700000000123
}
```

**资源不存在**：
```json
{
  "code": 40402,
  "message": "订单不存在",
  "requestId": "req_01K2Q8Z6F7",
  "timestamp": 1700000000123
}
```

**生产资金 Gate 拒绝**：
```json
{
  "code": 50310,
  "message": "生产资金链 Gate 未满足；D-001-DECISION、D-001-READINESS、P0-008、M6 的实际失败子集详见 failedGates",
  "failedGates": ["D-001-DECISION", "P0-008", "M6"],
  "requestId": "req_01K2Q8Z6F7",
  "timestamp": 1700000000123
}
```

此示例表示 `D-001-READINESS` 已通过，`D-001-DECISION`、P0-008 与 M6 未通过；数组按固定 enum 顺序排列，既不包含通过的 Gate，也不包含重复值。服务端为该响应追加一条同一 `requestId` 和相同 `failedGates` 的拒绝审计事件，但不写 payment intent、支付流水、余额占用或生产资金状态。

---

## 十、附录

### 附录 A：接口测试用例模板

```typescript
// server/tests/admin/users.spec.ts
describe('Admin Users API', () => {
  let adminToken: string;
  
  beforeAll(async () => {
    // 登录获取 Token
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = loginRes.body.data.accessToken;
  });
  
  describe('GET /api/v1/admin/users', () => {
    it('should return users list with pagination', async () => {
      const res = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, pageSize: 20 });
      
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta.page).toBe(1);
      expect(typeof res.body.requestId).toBe('string');
      expect(typeof res.body.timestamp).toBe('number');
    });
    
    it('should filter users by role', async () => {
      const res = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ role: 'leader' });
      
      expect(res.status).toBe(200);
      res.body.data.forEach((user: User) => {
        expect(user.role).toBe('leader');
      });
    });
  });
  
  describe('POST /api/v1/admin/users', () => {
    it('should create a new user', async () => {
      const newUser = {
        username: 'test_leader_001',
        email: 'leader001@example.com',
        password: 'password123',
        roleId: '2', // leader role
        parentUserId: '1', // admin user
        zhihuChannelId: 'ch_test_001',
      };
      
      const res = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newUser);
      
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.username).toBe(newUser.username);
    });
    
    it('should return error when username exists', async () => {
      const duplicateUser = {
        username: 'admin', // 已存在
        email: 'admin2@example.com',
        password: 'password123',
        roleId: '1',
      };
      
      const res = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(duplicateUser);
      
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(40001);
    });
  });
});
```

### 附录 B：Postman Collection 示例

```json
{
  "info": {
    "name": "知乎 KOC 运营平台 API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "baseUrl",
      "value": "http://localhost:3000",
      "type": "string"
    },
    {
      "key": "accessToken",
      "value": "",
      "type": "string"
    }
  ],
  "item": [
    {
      "name": "认证",
      "item": [
        {
          "name": "登录",
          "request": {
            "method": "POST",
            "url": "{{baseUrl}}/api/v1/auth/login",
            "header": [
              {
                "key": "Content-Type",
                "value": "application/json"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"username\": \"admin\",\n  \"password\": \"admin123\"\n}"
            }
          },
          "event": [
            {
              "listen": "test",
              "script": {
                "exec": [
                  "pm.test('Status code is 200', function () {",
                  "    pm.response.to.have.status(200);",
                  "});",
                  "",
                  "const jsonData = pm.response.json();",
                  "pm.collectionVariables.set('accessToken', jsonData.data.accessToken);"
                ]
              }
            }
          ]
        }
      ]
    },
    {
      "name": "Admin - 用户管理",
      "item": [
        {
          "name": "获取用户列表",
          "request": {
            "method": "GET",
            "url": {
              "raw": "{{baseUrl}}/api/v1/admin/users?page=1&pageSize=20",
              "query": [
                {
                  "key": "page",
                  "value": "1"
                },
                {
                  "key": "pageSize",
                  "value": "20"
                }
              ]
            },
            "header": [
              {
                "key": "Authorization",
                "value": "Bearer {{accessToken}}"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

### 附录 C：未关闭 Gate 与已确认约束

| ID | 项目 | v2 结论 | 关闭证据 |
|----|------|---------|----------|
| `A-001-SPEC` | OpenAPI 3.1 目标契约冻结 | 当前约 161 个候选 operation 是冻结前目标 inventory，不是实现数或发布声明 | 唯一 `operationId`、完整 Schema/权限/错误/幂等/审计、稳定 Test ID、lint、breaking check |
| `A-001-CONFORMANCE` | 已实施切片一致性 | 只统计 declared implemented 的 operation；目标已登记不等于实现 | 实际 route 无未登记项、runtime spec 无不存在的 implemented operation、Mock/真实 BFF 共用 Schema、真实 Contract Test；M6 Required implementation 100% |
| `A-002` | 官方 API 配额 | 必须实现账号级本地 quota budget；“暂不需要限流”作废 | 配额耗尽、并发预留和跨日恢复测试 |
| `A-003` | 作品版本 | 2026-08-25 前完成 v2 迁移，此后 v1 与 fallback 全部拒绝 | allowlist、代码搜索、单个/批量/更新契约测试 |
| `D-001-DECISION` | 权威结算来源业务决定 | Admin 审核 XLSX 只是目标首个 adapter；关闭前只允许 Mock、协议设计和非财务工作，不得实施实际 adapter、匿名样例导入、审批、中继或对账 | 用户对来源、字段、周期、币种、修订与冲正规则的书面确认 |
| `D-001-READINESS` | 权威结算来源工程就绪 | adapter、匿名样例、审批、中继、幂等、冲正与对账尚未验收 | 实际 adapter、匿名样例、审批、幂等、中继、冲正、对账与审计证据 |
| P0-008 | 提现账本分摊 | 目标对象与关联归 `A-001-SPEC`；runtime/migration 一致性尚未证明 | 不可变分摊、余额占用/释放、防双花、失败恢复、来源职责分离及对应运行证据 |
| `A-004` | 文件与导出 | 本地存储可作首版，但必须经存储 adapter；同步导出需硬性行数/字节/超时上限，超限转异步 | 限额、病毒/文件头、目录穿越与清理测试 |
| `A-005` | WebSocket | 需要，但握手、订阅与每条推送都复用 JWT + `project_members` scope；财务状态以 REST/DB 为准 | 越权订阅、断线重连、撤权后断开测试 |

---

**文档状态**：⏳ v2.1 Gate 分层修订待审核；`A-001-SPEC`、`A-001-CONFORMANCE`、`D-001-DECISION`、`D-001-READINESS` 与 P0-008 均未关闭

**下一步**：
1. 关闭 `A-001-SPEC`：将候选 inventory 收敛成可 lint 的目标 OpenAPI 3.1，分配唯一 `operationId`、完整 Schema/权限/错误/幂等/审计和 Test ID；不得将 planned operation 记为 implemented。
2. 在 2026-08-25 前完成作品 v2-only 验收并删除所有 v1 fallback。
3. 先由用户书面确认 `D-001-DECISION` 的来源、字段、周期、币种、修订与冲正规则；关闭前只允许 Mock、协议设计和非财务工作。关闭后，才以隔离沙箱中的实际 adapter、匿名样例、审批、幂等、中继、冲正和对账证据评审 `D-001-READINESS`；`D-001-DECISION`、`D-001-READINESS`、P0-008 与 M6 任一未通过时，生产结算、余额、提现和打款继续保持阻断。

---

**文档版本**：v2.1-review
**最后更新**：2026-08-17
**审核状态**：⏳ 待审核；阻断 Gate 见附录 C
