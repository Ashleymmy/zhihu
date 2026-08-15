# 10 · platform 权限门控

> 本文档是 `platform/` 前端路由门控的**唯一权威来源**。
> 新增 `/dashboard/z-*` 页面前必须读完「决策流程」一节。
>
> 与代码冲突时**以代码为准**，并立即回来修正本文档、注明修改日期。
> 权限常量定义见 `server/src/auth/permissions.ts`（服务端）与
> `platform/src/composables/usePermission.ts`（前端镜像），两者必须同步。

最后核对：2026-08-15（路由配置已更新，权限矩阵需人工复核）

---

## 目录

- [一、为什么需要这份文档](#一为什么需要这份文档)
- [二、三类门控](#二三类门控)
- [三、决策流程：新增页面](#三决策流程新增页面)
- [四、当前完整矩阵](#四当前完整矩阵)
- [五、门控逻辑写在哪](#五门控逻辑写在哪)
- [六、服务端对应关系](#六服务端对应关系)
- [七、自检方法](#七自检方法)

---

## 一、为什么需要这份文档

`platform/` 的路由守卫对 `/dashboard/z-*` 路径有一条**隐式回退**：没有显式声明
`access` 的 `z-*` 页面，自动按 `allianceAdmin`（即 `project.manage`，boss 专属）门控。

这条回退是对的 —— 绝大多数 `z-*` 页面确实调知乎联盟接口，而服务端
`allianceRouter` 整体要求 `project.manage`。回退保证前端守卫先挡住，
用户不会进到页面才被 403 打脸。

但它有个副作用：**只要路径以 `z-` 开头就会被锁成 boss 专属，哪怕这个页面
根本不碰联盟接口**。历史上 `字斟句酌Pro`、`我的改写`（纯本地文案工具，零网络调用）
和 `结算单`（只读 BFF `earningsApi`）三个页面就是这么被误锁的，
而它们的目标用户恰恰是团长和 KOC。

所以：**回退是兜底，不是判断依据**。判断依据是页面真实调用了什么。

---

## 二、三类门控

每个 `z-*` 页面必属于且仅属于以下一类。

### 第一类：联盟页面 —— 走默认回退

页面（或其 store）运行时调用 `@/api/alliance` 中任何 `alliance*Api`。

```ts
// 不写 access，让回退生效
meta: { requiresAuth: true }
```

服务端 `allianceRouter` 要求 `project.manage`，所以门控**必须**是
`allianceAdmin`，否则团长/KOC 进得去页面但每个请求都 403。

### 第二类：BFF 页面 —— 显式声明 access

页面只调 `platform/src/api/` 下的 BFF 接口（`plansApi`、`earningsApi`、
`tasksApi` 等），不碰联盟。

```ts
// 必须显式写 access，否则会被回退误锁成 boss 专属
meta: { requiresAuth: true, access: 'earnings' }
```

`access` 取值要和该页面实际调的 BFF 端点的服务端守卫**对齐** ——
见 [§6 服务端对应关系](#六服务端对应关系)。

### 第三类：纯本地页面 —— 声明 localOnly

页面零网络调用（纯前端计算、文本变换、静态内容）。

```ts
// localOnly 豁免回退，任何登录用户可访问
meta: { requiresAuth: true, localOnly: true }
```

`localOnly` 只做一件事：跳过 `allianceAdmin` 回退。它**不是**「公开页面」的意思，
`requiresAuth: true` 仍然生效，未登录用户照样被踢到登录页。

---

## 三、决策流程：新增页面

按顺序回答，第一个「是」就是答案。

```
1. 这个页面（含它用的 store）会调用 alliance*Api 吗？
   是 → 第一类。meta 不写 access，让回退生效。
   否 ↓

2. 它会调用任何 BFF 接口（http.get/post/...）吗？
   是 → 第二类。显式写 access，取值对齐服务端守卫（§6）。
   否 ↓

3. 零网络调用 → 第三类。写 localOnly: true。
```

判断第 1 步时**必须看 store 的运行时调用，不能只看 import**。
`import type { PopularizeTask } from '@/api/alliance'` 是类型导入，
编译后不留任何代码，不构成联盟依赖 —— `zTask.store.ts` 就是这个情况，
它 import 了 alliance 的类型，但实际请求走 BFF `tasksApi`。

准确的查法：

```bash
# 在 platform/src 下，统计真实运行时调用（而非类型导入）
grep -c "alliance[A-Za-z]*Api\." stores/zTask.store.ts   # 0 = 无联盟依赖
```

### 两处都要改

路由门控和侧边栏可见性是**两套独立逻辑**，改一处漏一处会导致
「菜单里看得见、点进去被弹回总览」或者反过来「菜单里没有、直接输 URL 能进」。

| 文件 | 改什么 |
| --- | --- |
| `platform/src/router/index.ts` | 路由 `meta`（`access` 或 `localOnly`） |
| `platform/src/layouts/DashboardLayout.vue` | `NavItem` 的 `access` / `localOnly` 字段 |

两处的回退判断必须保持字面一致，见 [§5](#五门控逻辑写在哪)。

---

## 四、当前完整矩阵

共 17 条 `z-*` 路由：13 条走回退、2 条 BFF、2 条本地。

| 页面 | 路径 | 类别 | 门控 | boss | leader | member |
| --- | --- | :---: | --- | :---: | :---: | :---: |
| 任务列表 | `z-tasks` | BFF | `plan` | ✅ | ✅ | ✅ |
| 结算单 | `z-settlement` | BFF | `earnings` | ✅ | ✅ | ✅ |
| 字斟句酌Pro | `z-writing-tool` | 本地 | — | ✅ | ✅ | ✅ |
| 我的改写 | `z-rewrite` | 本地 | — | ✅ | ✅ | ✅ |
| 计划管理 | `z-plans` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 作品管理 | `z-compositions` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 实时数据 | `z-report` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 常规书单 | `z-ranking` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 推荐书单 | `z-ranking-recommend` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 有声书库 | `z-audiobook` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 漫剧内容 | `z-comic` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 选品内容库 | `z-products` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 素材管理 | `z-materials` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 内容详情搜索 | `z-content-search` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 内容标签 | `z-content-tag` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 截流举报 | `z-intercept` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |
| 风险词 | `z-risk` | 联盟 | `allianceAdmin` | ✅ | ⛔ | ⛔ |

几个容易看错的地方：

- **`z-tasks` 是 BFF，不是联盟。** 它经 `tasksApi` 读 BFF `/tasks`，
  store 内用 `toPopularizeTask()` 把 `Task` 适配成旧的 `PopularizeTask` 形状，
  所以视图不用改。`GET /tasks` 只要 auth，三个角色都有 `plan.create`。
- **`z-products` 是联盟。** 它用 `useZChannelStore`，而 `zChannel.store` 调
  `allianceChannelApi`。`useZTaskStore` 无联盟依赖，但一个够了。
- **`z-settlement` 对三个角色都开放，但入口只在 admin 侧边栏。**
  worker 侧边栏走 `/dashboard/earnings`（同一批数据）。改成 `earnings` 门控是为了
  团长/KOC 用旧书签或直接输 URL 时不被误挡。

### 侧边栏分组

`DashboardLayout.vue` 按 `canAccess(auth.user, 'allianceAdmin')` 二选一：

| 分组 | 适用 | 「知乎」组内容 |
| --- | --- | --- |
| `adminZhihuGroup` | boss | 全部 17 条，六个子组（推广/工作台/盐选内容库/结算/创意中心/风控）|
| `workerZhihuGroup` | leader、member | `z-tasks` + 三个 BFF 页面 + 创意中心两个本地工具 |

---

## 五、门控逻辑写在哪

同一套回退判断，两个文件各写一遍。

`platform/src/router/index.ts`，全局前置守卫内：

```ts
// /dashboard/z-* 默认视作知乎联盟页面（服务端 allianceRouter 要求 project.manage）。
// meta.localOnly 的页面无任何联盟依赖，豁免该默认门控。
const allianceFallback = to.path.startsWith('/dashboard/z-') && !to.meta.localOnly
const access = (to.meta.access as AccessKey | undefined)
  ?? (allianceFallback ? 'allianceAdmin' : undefined)
if (access && !canAccess(auth.user, access)) {
  return next({ path: '/dashboard/overview', query: { denied: to.fullPath } })
}
```

`platform/src/layouts/DashboardLayout.vue`：

```ts
// 与 router/index.ts 的守卫保持一致：z-* 默认需要 allianceAdmin，localOnly 页面豁免
const accessForItem = (item: NavItem): AccessKey | undefined =>
  item.access
  ?? (item.to.startsWith('/dashboard/z-') && !item.localOnly ? 'allianceAdmin' : undefined)
```

### 为什么用 localOnly 而不是 access: undefined

回退用 `??`（空值合并）。显式写 `access: undefined` 会被当成「没提供」，
照样落到回退上，锁成 boss 专属。必须用一个独立标记跳过回退。

`localOnly` 同时起到自我说明的作用：在 callsite 就写清了「这页没有联盟依赖」，
下一个人加 `z-*` 页面时不会稀里糊涂继承门控。

---

## 六、服务端对应关系

写第二类页面时，`access` 取值查这张表。**服务端是唯一真相** ——
前端门控只是提前挡住，防止用户进到页面才吃 403。

| BFF router | 服务端守卫 | 前端 `access` |
| --- | --- | --- |
| `alliance` | 整体 `project.manage` | `allianceAdmin` |
| `auth`、`meta`、`earnings` | 仅 `requireAuth` | 无需（或按业务选 `earnings`）|
| `tasks` | `GET` 仅 auth；`POST /sync` 要 `project.manage` | `plan`（同步按钮单独门控）|
| `channels` | `GET` 仅 auth；`sync` / `owner` 要 `project.manage` | 按业务（管理动作单独门控）|
| `plans` | `plan.create` / `edit` / `delete`、`keyword.bind` | `plan` |
| `compositions` | `composition.create` / `edit` | `composition` |
| `callbacks` | `callback.config`、`callback.secret` | `callbacks` |
| `team` | `team.view` / `create_member` / `reset_pwd` / `disable` | `team` |
| `metrics` | `earning.view_team`、`project.manage` | `analytics` |
| `withdrawals` | `withdraw.apply` / `approve` | `earnings` |

注意 `tasks` 和 `channels` 是**方法级**守卫，不是整个 router。
列表接口只要 auth，管理动作才要 `project.manage`。所以页面门控按列表权限给，
管理按钮另外用 `auth.can('project.manage')` 单独包一层：

```vue
<a-button v-if="auth.can('project.manage')" @click="syncTasks">同步任务</a-button>
```

`AccessKey` → 权限的映射表在 `platform/src/access.ts`。
新增 `AccessKey` 要同时改那里和本文档这张表。

### 403 的兜底

`platform/src/api/http.ts` 对 403 不跳转（会话仍然有效），只在后端没返回
`message` 时兜底成「没有权限执行该操作」，避免把 Axios 原文
`Request failed with status code 403` 抛给用户。401 才清 token 跳登录页。

前端门控做对的话，用户走 UI 不该看到 403。真看到了，说明前端门控和服务端守卫
对不上 —— 回来查 §6 这张表。

---

## 七、自检方法

改完门控，两步验证。

**第一步：类型检查。** 注意 `npm run build` 的 `vue-tsc` 在部分环境下会调
`node.exe` 而失败，直接用 node 跑：

```bash
cd platform
node ./node_modules/vue-tsc/bin/vue-tsc.js --noEmit
```

**第二步：复算门控矩阵。** 把 `router/index.ts` 的回退逻辑和
`server/src/auth/permissions.ts` 的角色权限表抄进一个脚本，
枚举三个角色对目标路由的可达性，和 [§4](#四当前完整矩阵) 对照：

```js
const gate = (path, meta = {}) => meta.access
  ?? ((path.startsWith('/dashboard/z-') && !meta.localOnly) ? 'allianceAdmin' : undefined)
const canAccess = (role, a) => !a || ROLE[role].includes(accessPermissions[a])
```

新增页面后把它加进 §4 的表。这张表是回归基线 ——
下次有人动回退逻辑，跑一遍就知道有没有连带改坏别的页面。

---

## 相关文档

- [08-BFF接口契约.md](./08-BFF接口契约.md) — BFF 端点、数据格式、建表
- [09-后端开发规范.md](./09-后端开发规范.md) — 服务端 `requirePermission` 用法
- [01-架构设计.md](./01-架构设计.md) — 安全边界（为什么签名只在后端）
