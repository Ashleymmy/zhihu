> 2026-10-01：当前小程序使用 `opc-bridge` 访问网站共享后端。部署和账号规则见 [共享后端说明](../docs/wechat-shared-backend.md)。以下旧云数据库操作仅用于历史版本回滚，不要对当前版本批量部署旧函数。

# timo-opc 微信小程序与云开发迁移

2026-09-23：`0.1.0` 内测代码已上传，测试环境三个云函数已同步。260 项自动测试、五角色共 95 项页面检查通过；后台体验版设置、下载域名与真机验收进度见 [内测记录](docs/INTERNAL-BETA-2026-09-23.md)。

原生 WXML / WXSS / JavaScript 小程序，目标架构是 **微信云函数 + 云数据库 + 云存储**。小程序调用 `wx.cloud.callFunction`，云端不依赖本地 HTTP 服务、MySQL 或 Redis。MySQL 只作为迁移数据源保留。

- 工程目录：`D:\ITEM\zhihu-app\weixin-app`
- AppID：`wx22b91776ccf37354`
- 云环境：开发 `cloud1-d4g9ou4cd3b80d764`（迁移数据源，冻结，不挂载任何版本）；生产 `test-opc-app-d3gki762bfb61da92`（已完成迁移并 seal，**2026-09-24 起扶正为正式生产环境**，个人版套餐需保持续费）
- 工程名：`timo-opc`
- 环境配置：`miniprogram/config/env.js`

**当前状态（2026-09-24）：`test-opc-app-d3gki762bfb61da92` 已完整走完一遍上线流程并 seal，
业务写入已开放；模拟器五角色页面验收通过。该环境已扶正为正式生产环境（内部用户已注册），
`env.js` 三个版本槽位均指向它；开发环境 `cloud1` 冻结为迁移数据源，不再挂载任何版本。
`release` 版守卫改为「指回开发库则拒绝启动」。**
预演的全部步骤与独立回读证据见 [cloudbase/REHEARSAL-2026-09-18.md](cloudbase/REHEARSAL-2026-09-18.md)；
剩余项（正式生产环境、五角色真机、`downloadFile` 合法域名、大账户容量与恢复演练）见该文件与
`cloudfunctions/*/release.json`。

测试环境已完成项：50 个集合、27 批 203 条记录（`verified=true`，无缺失/不一致）、历史发票已迁入云存储并核对哈希、
44 条查询索引回读 `desired=44 present=44 missing=0`、事务原语七项通过、隔离业务验收五阶段 `passed`、
存储验收（1 MB / 3 分片 / 回读哈希一致 / 清理完成）`passed`、worker 定时触发器心跳 `outcome=completed`。

本轮完成项、云端待验证项和控制台操作另见 [明早后端接续清单](cloudbase/MORNING-CHECKLIST.md)。

环境 ID 已通过官方 CLI 核实：`d4g9` 后是字母 `o`，不是数字 `0`。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [cloudbase/REHEARSAL-2026-09-18.md](cloudbase/REHEARSAL-2026-09-18.md) | **测试环境上线预演记录**：逐步操作与每条独立回读证据 |
| [cloudbase/HANDOFF-2026-09-18.md](cloudbase/HANDOFF-2026-09-18.md) | **迁移交接总览**：架构、已完成项、未完成项、后续顺序 |
| [cloudbase/MORNING-CHECKLIST.md](cloudbase/MORNING-CHECKLIST.md) | 需要人在云控制台执行的操作 |
| [cloudbase/MIGRATION.md](cloudbase/MIGRATION.md) | 数据迁移细节 |
| [cloudbase/TRANSACTIONS.md](cloudbase/TRANSACTIONS.md) | 事务限制与集合写入协议 |
| [cloudbase/STORAGE-RULES.md](cloudbase/STORAGE-RULES.md) | 文件上传方案与云存储规则 |
| [cloudbase/UI-API.md](cloudbase/UI-API.md) | UI 重构用的接口约定 |
| [docs/API-REFERENCE.md](docs/API-REFERENCE.md) | 接口参考（当前 50 个，云端共 201 个） |
| [docs/FRONTEND-INTEGRATION.md](docs/FRONTEND-INTEGRATION.md) | 前端接入示例与业务流程代码 |
| [docs/LOCAL-TESTING-CHECKLIST.md](docs/LOCAL-TESTING-CHECKLIST.md) | 开发者工具与云端联调清单、上云前检查 |
| [docs/IMPLEMENTATION-COMPLETE.md](docs/IMPLEMENTATION-COMPLETE.md) | 前端上传接入改动记录与已知缺陷 |
| [docs/PRODUCTION-ROLLOUT.md](docs/PRODUCTION-ROLLOUT.md) | **生产环境上线路径**：拆分环境、部署、触发器、验收、seal 的完整顺序与验证方式 |
| [docs/FEATURE-GAPS.md](docs/FEATURE-GAPS.md) | **页面能力缺口**：后端已就绪但 UI 未接入、完全无页面的场景 |
| [docs/UI-设计方向.md](docs/UI-设计方向.md) | UI 重构方向 |

**测试基线为 271 项**（`npm test`）：108 项云函数逻辑 + 16 项 `tests/upload.test.cjs` + 15 项 `tests/home-mine.test.cjs` + 14 项 `tests/interaction.test.cjs`（下拉刷新/触底加载/危险确认）+ 14 项 `tests/wallet-funding.test.cjs` + 13 项 `tests/admin-page.test.cjs` + 13 项 `tests/team-members.test.cjs` + 9 项 `tests/income-page.test.cjs` + 7 项 `tests/auth-register.test.cjs`（注册/绑定/手机号登录）+ 6 项 `tests/auth-pages.test.cjs` + 6 项 `tests/courses.test.cjs` + 6 项 `tests/pricing-groups.test.cjs`（角色全局价/返利配置）+ 6 项 `tests/keyword-auto-retry.test.cjs`（放通自动重试）+ 6 项 `tests/migration-diagnostic.test.cjs` + 5 项 `tests/keyword-edit-delete.test.cjs`（编辑重试/删除失败关键词）+ 5 项 `tests/transaction-retry.test.cjs` + 4 项 `tests/home-summary.test.cjs` + 4 项 `tests/storage-acceptance.test.cjs` + 4 项 `tests/prices-page.test.cjs` + 3 项 `tests/invite-page.test.cjs` + 2 项 `tests/college-page.test.cjs` + 1 项 release 环境守卫。

## 微信开发者工具

导入本目录，使用现有 AppID。CLI 所需的“服务端口”位于**有代码编辑器和模拟器的开发者工具主窗口 → 顶部设置 → 安全设置 → 服务端口**；部分版本从“工具 → 设置”进入。

云开发控制台左下角的“设置 → 权限设置”不是此入口。那里“未登录用户访问权限”保持关闭。

当前使用 `wx.cloud.callFunction`，不再配置 `127.0.0.1:3001` 的 request 域名。云存储凭证下载仍须按实际云存储域名配置并真机验证 `downloadFile`。**两个环境的真实域名都已用官方接口取到**（各用一个 12 字节探测文件取得后删除）：

| 环境 | `getTempFileURL` 返回链接的实际主机，**`downloadFile` 合法域名要填这个** | 云存储 CDN 域 |
| --- | --- | --- |
| 开发 `cloud1-d4g9ou4cd3b80d764` | `636c-cloud1-d4g9ou4cd3b80d764-1490018601.cos.ap-shanghai.myqcloud.com` | `636c-cloud1-d4g9ou4cd3b80d764-1490018601.tcb.qcloud.la` |
| 测试 `test-opc-app-d3gki762bfb61da92` | `7465-test-opc-app-d3gki762bfb61da92-1490018601.cos.ap-shanghai.myqcloud.com` | `7465-test-opc-app-d3gki762bfb61da92-1490018601.tcb.qcloud.la` |

`miniprogram/pages/withdrawals` 的凭证查看用 `wx.downloadFile({url})` 拉这个临时链接，因此下载域名必须在
小程序后台配置，否则真机上会失败（开发者工具勾选「不校验合法域名」时不受影响，容易漏掉）。
**这一条仍未配置**：开发/体验/正式三个版本目前指向上表对应环境；正式发布前应完成配额、备份和环境隔离评估，
并按目标环境重新取域名。

## 云函数

| 函数 | 职责 |
| --- | --- |
| `opc-api` | 账号认证、项目/团队、关键词/作品、定价、财务、报表、文件授权和运营操作 |
| `opc-worker` | 报表归因、计划/作品提交、旧日报/收益结算及联盟写任务；租约与游标保存在云数据库 |
| `opc-admin` | 一次性迁移初始化、按清单导入、内容校验和关闭迁移入口 |

`opc-api/lib` 与 `opc-api/vendor` 是共享代码源；另外两个函数中的副本由脚本生成，修改共享代码后必须重新打包。`vendor` 复用现有 TypeScript 的 XLSX 校验、报表解析和知乎签名/协议定义，保留来源哈希。

部署脚本只上传 `opc-api`、`opc-worker`、`opc-admin` 三个函数。（云开发模板自带的 `quickstartFunctions` 已删除。）

## 安装与本地检查

```powershell
cd D:\ITEM\zhihu-app\weixin-app
npm ci --prefix cloudfunctions/opc-api
npm run cloud:package
npm test
npm run check:wechat
npm run cloud:routes
npm run cloud:check
npm run cloud:bundle
```

安装仓库 server 依赖后再运行测试及打包（打包使用其 `esbuild`）。源 TypeScript 更新后执行 `npm run cloud:vendor`。`check:wechat` 自动查找新版和旧版开发者工具的官方编译器；非默认安装目录设置 `WECHAT_COMPILER_DIR`。

### PowerShell 版本要求

`scripts/*.ps1` 同时支持 Windows PowerShell 5.1（Windows 自带）和 PowerShell 7。此前它们**只在 PowerShell 7 下可用**，在 5.1 下有三种必然失败：

1. 无 BOM 的 UTF-8 `.ps1` 被按 GBK 误读，`微信web开发者工具` 路径变成乱码，报「无法将 ... 识别为 cmdlet」
2. `Set-Content -Encoding utf8` 在 5.1 写入 BOM，云端 CLI 拒绝解析查询文件（`Unexpected token ''`）
3. `$ErrorActionPreference='Stop'` 下原生命令写 stderr 会变成终止性错误，而 CLI 每次都会往 stderr 打日志

现已分别通过「`.ps1` 一律保存为带 BOM 的 UTF-8」「`CloudTools.ps1` 的 `Write-Utf8NoBom`」「`CloudTools.ps1` 的 `Invoke-WechatCli`」解决。`npm run check` 会强制校验 BOM，被编辑器或工具丢掉时会直接报错。

### 模拟器五角色端到端验收

```powershell
# 1) 先备好可登录账号（重置达人/团长密码、补建运营/财务管理员、给项目权限）
$env:WEIXIN_ACCEPTANCE_PASSWORD = '<admin 密码>'
& .\scripts\provision-acceptance-accounts.ps1
# 账号与统一密码写入 ../.runtime/weixin-acceptance/accounts.local.json（已 ignore）

# 2) 逐角色跑页面链路
$env:WEIXIN_ACCEPTANCE_USERNAME = 'admin'      # 也可 test1 / test2 / ops001 / fin001
$env:WEIXIN_ACCEPTANCE_PASSWORD = '<对应密码>'
& .\scripts\simulator-acceptance.ps1 -ProbeGateWrite
```

登录后逐个访问全部页面，核对路由、权限判定、作用域标签与页面错误，截图与报告写入
`../outputs/weixin-acceptance/`（报告按账号命名）。**期望的页面权限不写死角色**：
脚本按登录账号的 `role + adminDuty` 推出该角色应该能进哪些页（口径同 `utils/permissions.js`），
无权限页要求停在原地并 `denied=true`，有权限页要求 `allowed=true`、作用域标签非空、无错误。
真机验收成本高，改代码后先用它筛掉页面级问题。

`-ProbeGateWrite` 会用一个必然被拒的 payload 探测写入门禁：返回 `409` 表示还在 UI 预览模式，
返回 `422/403` 表示业务写入已开放（该请求不产生任何写入）。

三个已实测的坑：tabBar 页只能用 `switchTab`、其余页只能用 `navigateTo`（用错会静默停在当前页，
从而读到上一页的数据造成误判）；登录前必须清掉上一个会话的存储键，否则会整轮验在上一个账号上；
登录是云函数往返且落地页由 `entryPath` 决定（财务管理员直接落在 `wallet`），所以必须轮询而不是固定等待。

### 生产环境守卫

`miniprogram/config/env.js` 的环境映射：`develop → development`、`trial → test`、`release → production`。
2026-09-24 起（用户决定）：不再另建独立生产环境，`test-opc-app-d3gki762bfb61da92` 扶正为正式生产环境，
三个槽位（development/test/production）全部指向它；开发库 `cloud1` 冻结为迁移数据源。
守卫保留：任何版本指回开发库时 `release` 版直接抛错拒绝启动。
`tests/edges.test.cjs` 已改为断言 release 使用生产环境。

### 可用的开发者工具 skill CLI

`wechatide.cmd -c <client> <tool>` 的能力远多于本仓库脚本用到的那几个。除云数据库读写/结构外，
还有 `cloud_fn_deploy`（部署云函数，实测确认流程会自动放行）、`cloud_fn_inc_deploy`、
`cloud_fn_info`、`cloud_fn_list`、`cloud_env_list`、`cloud_query_storage`、`cloud_manage_storage`，
以及 `[automation]` 段的模拟器驱动（`automation_navigate`、`automation_page_action`、
`automation_evaluate`、`automation_wx_api`、`simulator_screenshot`、`get_simulator_console`、
`get_simulator_network`）。完整清单用 `wechatide -h` 查看。

**能力边界（已实测）**：skill CLI 里**没有云函数调用（invoke）工具，也没有触发器工具** ——
这两件事用 CloudBase CLI：`tcb fn invoke <name> -d "@<事件文件>" -e <envId>` 与
`tcb fn trigger create <name> --trigger-name ... --cron "0 * * * * * *" -e <envId>`。
`opc-admin` 的隔离业务验收入口会拒绝带 OPENID/APPID 的调用，因此必须走 `tcb fn invoke`
（它不带小程序身份）。用 `cloud_fn_deploy` 部署函数代码**不会**注册触发器。

⚠️ **自动化桥会静默挂死**：所有 `automation_*` 都会返回 `timeout waiting for automator response`，
此时 `reLaunch` 不生效，容易把「停在上一页」误判成页面缺陷。`simulator-acceptance.ps1` 现在会在
刷新后先探活、并在无响应时直接报出可执行的处置办法；`cloud_fn_deploy` 与 `automation_evaluate`
的响应等待时间都很短，**一次调用里串太多云请求会超时**（拆分步骤即可）。

测试包含权限/会话、重复提交、关键词与作品闭环、资金不足拦截、真实 XLSX 解析、文件归属、付款凭证、报表更正及迁移门禁。数据库事务测试使用内存适配器，**不能代替真实 CloudBase 并发与规则测试**。

本地自动测试涵盖差额账本、旧账对账、两级审批、应付确认、上游配额、任务不确定结果、可恢复导入，以及 CloudBase 事务适配；当前有 108 项测试。另检查 13 个页面和官方 WXML/WXSS 编译、单文件包启动，防止打包遗漏动态模块。测试文件按顺序运行，避免本机 Node 24.18 在并行 VM 测试退出时出现原生崩溃；测试内部的并发领取/提现场景仍保留。真实 CloudBase 验收单独记录。事务限制及集合写入协议见 [TRANSACTIONS.md](cloudbase/TRANSACTIONS.md)。

`smoke:api` 仅用于迁移期间对照原 HTTP 服务，并不验证云函数。

## 部署到指定环境

在主窗口开启服务端口并登录后执行：

```powershell
cd D:\ITEM\zhihu-app\weixin-app
.\scripts\deploy-cloud.ps1 -Environment <envId>     # 必填；体验版使用 test-opc-app-d3gki762bfb61da92
```

脚本先测试、编译、打包，再检查当前账号可见的目标环境，然后上传三个函数并在云端安装依赖。部署包位于忽略的 `.runtime/cloud-bundles`，每个函数业务代码合并为单个 `index.js`，避免 Windows 上传子目录后的云端模块解析错误；直接上传源码目录不作为已验证的部署方式。首次创建遇到 Creating 状态会有限重试。某些开发者工具版本失败时退出码仍为 0，脚本同时检查错误文本。

**替代路径（不需要开服务端口，且能保留函数既有配置）**：用 skill CLI 逐个部署，预演时用的就是这条，每个函数约 1 分钟：

```powershell
cd D:\ITEM\zhihu-app\weixin-app
node scripts\bundle-cloud.cjs --env <envId>          # 重新打包（release.json 会被打进 index.js）
& 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd' -c Codex cloud_fn_deploy `
  --appid wx22b91776ccf37354 --env <envId> --path D:\ITEM\zhihu-app\.runtime\cloud-bundles\opc-api --remote-npm-install
```

⚠️ 不要用 `tcb fn deploy`：它读 `cloudbaserc.json`（仓库没有该文件），可能把函数超时从 60 秒重置为默认值。

上传不会初始化业务数据，也不会开放业务入口。运行时、超时、内存、触发器与权限规则必须在云控制台核对；`cloudbase/deployment.json` 和 `cloudbase/indexes.json` 是待应用的配置清单，不表示云端已经配置。

迁移期间的特殊管理员包通过 `node scripts/bundle-cloud.cjs --migration --env <envId>` 构建，**仅 opc-admin 含忽略目录中的开发库快照和原始发票**。常规部署脚本会重新生成不含快照的包，不能在导入进行中用它覆盖迁移包。导入结束后再部署普通管理员包并移除迁移密钥。

环境变量只在云函数配置中保存，不写入小程序、仓库或聊天：

- `opc-api`、`opc-worker`：`ZHIHU_ACCESS_TOKEN`、`ZHIHU_SECRET_KEY`。
- `opc-api`：`OPC_CALLBACK_KEY`，用于回传配置密钥加密；`OPC_ZHIHU_DAILY_LIMIT` 可选，默认 1000 次/天。
- `opc-admin`：`OPC_MIGRATION_SECRET`，至少 32 位随机值。**CLI 改不了函数环境变量**（`tcb fn env` 只有 `pull` 子命令），新环境必须由人在云开发控制台逐个配置。

**已核实云配置（开发环境与测试环境都回读过）：** 三个函数运行在 `Nodejs16.13`，超时 60 秒。上游客户端
已改为 Node 16 兼容 HTTPS，15 秒截止，不依赖全局 `fetch`。两个环境都通过了 `check-runtime`：事务原语七项全通过、
`opc-api` 凭据与回传加密已配置、`opc-worker` 凭据与上游只读请求可用。测试环境 seal 之后，worker 心跳
`outcome` 已从 `migration-gated` 变为 `completed`，即真正开始执行后台作业。内存及生产配额仍需核验。

worker 的定时触发器配置在 `config.json`，使用官方文档要求的七段格式 `0 * * * * * *`（含年份，每分钟第 0 秒）。
skill CLI 没有触发器工具，用 CloudBase CLI 创建（项目树右键「上传触发器」同样可行）：
**函数代码部署不代表触发器已经生效，必须回读 `worker-heartbeat` 确认。**
预演时实测到触发器会**静默消失**：`tcb fn trigger` 没有 list 子命令，唯一判据是心跳停住，
处置办法是重新 create 一次（同名创建成功即说明此前已不存在），见
[docs/PRODUCTION-ROLLOUT.md](docs/PRODUCTION-ROLLOUT.md) 第 6 步。
上游返回不明确的创建请求标为 `uncertain`，不会自动重复创建；运营核对知乎端后再确认。

真实云调用证据见 [cloudbase/deployment-smoke.json](cloudbase/deployment-smoke.json)，不包含账号令牌或 OPENID。复测方法：

```powershell
cd D:\ITEM\zhihu-app
npm install --prefix .runtime/wechat-tools --no-audit --no-fund miniprogram-automator@0.12.1
& 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat' auto --project D:/ITEM/zhihu-app/weixin-app --auto-port 9420
cd weixin-app
npm run smoke:cloud
```

该检查只读调用身份、迁移门禁和后台函数访问限制，不登录、导入或写入业务数据；当前预期是身份成功、业务暂未开放、后台直调被拒绝。完成数据迁移后须更新该阶段的预期。

## 数据库与文件权限

全部业务集合使用 `opc_` 前缀，集合清单见 `cloudfunctions/opc-api/lib/store.js`。**所有业务集合禁止客户端直接读写**，仅由云函数使用服务端权限访问。50 个集合的客户端读写限制已在真实环境验证，无需重新配置。云存储目前仍禁止客户端读写，云函数上传方案及实测步骤见 [STORAGE-RULES.md](cloudbase/STORAGE-RULES.md)。

前端 `miniprogram/utils/upload.js` 已接入云函数分片上传：先 `POST /core/files/prepare` 取得服务端指定路径与用途，返回 `upload.transport=cloud-function` 时按 512 KiB 分片调用 `POST /core/files/:id/upload-chunk`，再调 `POST /core/files/:id/finish-upload` 合并校验。付款登记会复制服务端凭证快照并记录内容哈希；查看时再次核对哈希，生成短时链接。

**分片上传链路已在两个环境的真实云存储上跑通**（`check-storage` 验收：1 MB / 3 分片 / 合并 / 回读哈希一致 /
幂等重放 / 隔离性 / 清理完成，`objectsRemoved=true`）。云存储仍然禁止客户端直接读写，上传下载都走云函数。
仍需在真机上验证 `downloadFile` 合法域名后的凭证查看效果。已知限制：**未实现断点续传**（中断后从第 0 片重传），
详见 [docs/IMPLEMENTATION-COMPLETE.md](docs/IMPLEMENTATION-COMPLETE.md)。

## 账号与权限

保留原数据库账号和 bcrypt 密码哈希，不新增默认万能密码。云端账号密码登录后获得随机会话令牌，有效期 8 小时，绑定微信提供的可信 OPENID；数据库只存令牌哈希。角色、员工职责、账号停用和密码变更均由服务端检查。

**注册与绑定（2026-09-23 起）**：

- **注册页**（`pages/register`）：手机号 + 密码 + **邀请码（强制）**。注册成功后系统自动分配账号 id（`u` 前缀），角色为达人，并按邀请码确定团队归属（`parentId`：团长的码归属团长本人，达人的码归属其上家）与项目权限（自动写入 `members`）。
- **手机号即账号**：登录框支持直接输入手机号 + 密码（`keys` 集合按 `phone` 索引）。
- **微信一键登录**：openid 已绑定账号直接发会话；未绑定返回 `needsBind`，小程序引导到绑定页（`pages/bind`，手机号 + 邀请码）。手机号已注册时验证原密码完成绑定；未注册则等同注册流程开户。
- **密码登录顺带绑微信**：账号密码登录成功且当前微信未绑定任何账号时自动绑定 openid，下次可一键登录（一个微信只认一个账号，不抢占）。
- 注册/绑定接口为公开路径（`POST /core/auth/register`、`POST /core/auth/bind`），按 openid + 手机号限流（15 分钟 10 次）；首次写 `opc_invite_codes` / `opc_invite_rewards` / `opc_courses` 时云端自动建集合。

| 角色 | 页面功能 |
| --- | --- |
| 达人 | 关键词、提交作品/进度、收入、提现 |
| 团长 | 团队关键词、分配、审核作品、团队收益、成员、定价 |
| 运营管理员 | 项目/成员、渠道/任务同步、关键词、作品、价格、上游状态核对 |
| 财务管理员 | 账单确认、报表上传/预览、异常/更正处理、开放提现、提现审批与付款登记 |
| 全量管理员 | 上述全部功能 |

新建成员的临时密码在创建后显示，首次登录须修改。创建账号不等于授权项目。退出或 401 会清除令牌、用户和当前项目；没有权限的页面拒绝访问。

## 财务与报表

报表通过微信聊天文件选择器上传 XLSX，最大 10 MB。先查看预览，再明确确认导入；worker 处理后显示异常或等待财务核对。相同来源数据不会重复归因，更正先进入待审核状态，期间相关款项暂停使用。

账单确认、开放提现和付款保留独立账务记录；余额读取当前投影并扣除处理中/已支付提现。付款登记需要流水号、日期、PNG/JPG/PDF 凭证和实际付款确认，**不会自动转账**。

当前尚有批量规模限制：通用查询最多 2000 条；新增选定来源确认支持单个 factId，选定资金开放支持 1–3 个 incomeId，接口说明见 [UI-API.md](cloudbase/UI-API.md)。旧整批接口保留原有上限，但大账户钱包及整批操作仍可能触及 90 次事务操作预算。worker 每次最多处理 2 个任务、每个导入任务 10 行，每行独立事务；报表解析每 20 行保存进度，返回 preparing 时使用同一 fileId 继续准备。真实云端吞吐和大账户处理仍需改造/实测，超限不会被静默截断。

旧收益和提现保留独立历史账，金额单位为**分**，新钱包为**元**；不能直接合并余额。修订通过不可变差额分录调整金额，新增收益不会把已开放余额重新冻结。旧 `approved` 提现保留原义，不伪造为实际已付款。

## 数据迁移与剩余工作

详见 [cloudbase/MIGRATION.md](cloudbase/MIGRATION.md)。UI 重构使用 [cloudbase/UI-API.md](cloudbase/UI-API.md)。机器生成的 [route-coverage.json](cloudbase/route-coverage.json) 当前统计 178 个源声明、201 个云处理器：170 个源路径匹配、7 个明确替代、1 个上游协议阻挡、0 个未分类待迁移。同路径不表示行为等价或验收通过。

当前开发库批次与发票核验已通过，证据见 cloudbase/import-verification.json；
测试环境的导入与验收证据见 [cloudbase/REHEARSAL-2026-09-18.md](cloudbase/REHEARSAL-2026-09-18.md)。
仍须完成**正式生产环境搭建、五角色真机验收、`downloadFile` 合法域名配置、大账户容量与生产恢复演练**；
正式业务数据来源仍待确认。原服务只有回传配置管理，没有发送器或入站签名回调，不能将其写成已迁移能力。
旧计划自动状态查询缺少正式知乎契约，明确返回 409 并提供人工核对入口。
