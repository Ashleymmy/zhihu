# 页面能力缺口

对照 `cloudbase/UI-API.md` 与云端已注册的 201 条路由，逐条核对小程序 13 个页面实际调用的接口。

生成方式（可复现）：提取 `miniprogram/**/*.js` 中出现的接口路径字面量，与 `cloudbase/native-routes.json` 求差集。

---

## 一、后端已就绪、UI 未接入 —— 已于 2026-09-18 接入 ✅

### 3. 团队成员管理

`pages/team` 原先只能**新建**成员和审核入团申请，不能改资料、重置密码、停用或删除——
团长无法处理离职成员。四个后端接口都已存在，现已接入（成员行「管理」→ 弹层）：

| 动作 | 接口 | 说明 |
| --- | --- | --- |
| 改资料 | `PATCH /core/team/members/:id` | 仅 `displayName` / `phone`（后端不接受改角色） |
| 重置密码 | `POST /core/team/members/:id/reset-password` | 留空则由服务端生成一次性临时密码并强制下次改密；手填则要求至少 8 位 |
| 停用 | `POST /core/team/members/:id/disable` | 停用后会话立即失效；当前登录账号不提供该操作（服务端也会拒绝） |
| 删除 | `DELETE /core/team/members/:id` | 走后端 `mutate`，**必须带请求键**；有关联业务记录时服务端返回 409，提示改用停用 |

`utils/actions.js` 为此新增通用的 `send(owner, method, path, payload)` 与 `del(...)`，
让 DELETE 也能走同一套请求键纪律（原先只有 `post` 带键）。

覆盖测试：`tests/team-members.test.cjs`（13 项）。
模拟器实测：5 名成员正常渲染，点击「管理」后 `.modal-mask` 从 0 变 1，字段已预填。

`pages/wallet` 原先走整批接口，在大账户上会撞后端上限且没有降级路径。现已改为分批：

| 动作 | 原实现 | 现实现 |
| --- | --- | --- |
| 财务确认 | `POST /modules/zhihu/workbench/confirm` 不带 `factIds`，整批提交；可确认来源超过 20 条时后端返回 413 | 按来源逐条：先 `GET /modules/zhihu/workbench` 带 `factIds:[id]` 取**该批专属** `reviewHash`，再以同一组 `factIds` 确认。单次点击最多顺序处理 10 条，剩余数量在提示里告知 |
| 资金开放 | 用 `GET /core/finance` 返回的整批 `funding.hash`；待开放款项超过 50 条时返回 413 | `GET /core/finance/funding-preview` 按 cursor 分页取候选 → 勾选 1–3 条 → 再次 GET 同一路径带 `incomeIds` 取本批 `amount`/`hash` → 以相同 `incomeIds`+`hash` 提交 |

要点：

- 每条来源必须使用后端为该批重算的 `reviewHash`，沿用整批哈希会被判为「数据已变化」
- 选择变化后旧报价立即失效，避免拿旧哈希提交
- 两条链路的请求键都来自 `actions.post`，同一 payload 复用同一键，重复点击不会重复记账
- 覆盖测试：`tests/wallet-funding.test.cjs`（14 项）

已接入的接口此前完全未被引用：`/core/finance/funding-preview`。

`docs/API-REFERENCE.md` 原有两处与实现不符，已更正：`funding-preview` 候选行字段是 `id`（不是 `incomeId`）；
`GET /modules/zhihu/workbench` 返回的是 `entries`（不是 `rows`）。

---

## 二、完全没有页面的场景

以下路由**不被任何页面的路径字面量引用**：

| 场景 | 路由 | 说明 |
| --- | --- | --- |
| **公告** | `GET /core/announcements/active`、`GET /core/announcements`、`POST /core/announcements`、`POST /core/announcements/:id/status` | 用户看不到任何公告；运营也无法发布 |
| **审计日志** | `GET /core/audit-logs`、`GET /core/audit-logs/actions` | 运营无法自查操作记录 |
| **运营工具** | `/core/admin-tools/monitor`、`/db-stats`、`/audit-cleanup`、`/site-info`、`/announcements` | 仅 Web 端有 |
| **人员与 MCN** | `/core/staff`（GET/POST/PATCH）、`/core/mcn-accounts`（GET/POST） | 员工账号与 MCN 账号管理 |
| **模块汇总** | `GET /core/modules`、`GET /core/modules/:moduleId/summary` | 首页未接入待办/收益汇总（`UI-设计方向.md` §6 第 2 条也提到） |
| **付款单** | `GET /core/finance/payment-sheet` | 财务无法导出付款单 |
| **接入账号编辑** | `PATCH /core/integrations/:id` | 项目页只能关联/解绑，不能改接入账号属性 |
| ~~`POST /core/auth/refresh`~~ | — | 已明确替代为"过期重新登录"，**不算缺口** |

---

## 三、需要产品决策，不是补代码

| 项 | 现状 | 需要决定 |
| --- | --- | --- |
| 对账单 `/modules/zhihu/statements`（5 条） | 无页面。`UI-API.md:37` 说明它表示"付款主体认可应付"，与 `workbench/confirm` 是两步不同的动作 | 小程序是否需要独立的对账单页面 |
| 联盟接口 `/modules/zhihu/alliance/api/*` | 无页面（供 worker 使用）。`UI-API.md:74` 说这是"管理员直接操作接口" | 是否需要在小程序里直接调用 |
| 历史业务 `/modules/zhihu/plans|compositions|earnings|withdrawals` | 部分通过钱包/提现页间接使用 | 历史账是否需要独立入口 |
| 归因追溯 `/attributions`、`/attributions/:id/trace`、`/recompute` | `reports` 页只做了异常重试与更正接受/拒绝 | 是否需要单条归因的追溯视图 |

---

## 与 README 角色能力表的对照

README 定义的角色能力**全部已落地**，本文件的缺口都在那张表之外：

| 角色 | README 要求 | 落地页面 |
| --- | --- | --- |
| 达人 | 关键词、提交作品/进度、收入、提现 | keywords / works / wallet / withdrawals ✅ |
| 团长 | 团队关键词、分配、审核作品、团队收益、成员、定价 | keywords / works / wallet / team / prices ✅ |
| 运营管理员 | 项目/成员、渠道/任务同步、关键词、作品、价格、上游状态核对 | projects / team / admin / keywords / works / prices ✅ |
| 财务管理员 | 账单确认、报表上传/预览、异常/更正处理、开放提现、提现审批与付款登记 | wallet / reports / withdrawals ✅ |

因此：**"角色能力表覆盖完整"成立，"小程序等于 Web 端全部功能"不成立。**
后者需要明确范围后再决定。
