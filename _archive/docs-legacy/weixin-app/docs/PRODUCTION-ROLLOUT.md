# 生产环境上线路径

本文只写**拆分独立生产环境到正式可上线**的步骤。开发环境已完成的部分（44 条索引、触发器、隔离业务验收通过）见
`MORNING-CHECKLIST.md`。

**当前状态（2026-09-18 18:2x）**：`test-opc-app-d3gki762bfb61da92` 已**完整走完一遍上线流程**
（集合、数据、历史发票、44 条索引、三函数、触发器、隔离业务验收、存储验收、seal），
业务写入已开放，模拟器五角色验收已完成。详细证据见
[REHEARSAL-2026-09-18.md](../cloudbase/REHEARSAL-2026-09-18.md)。
**独立生产环境仍未建立**，`env.js` 的 production 仍指向开发环境，守卫继续拦截正式发布。

> ⚠️ 该环境控制台显示**到期 2026-10-18**（开发环境为 2027-03-17），只有一个月。
> 若要作为长期生产环境使用，需先确认续期；仅作体验版/预发则无妨。
> 本轮按用户决定把 `release.json` 的 `ready` 置为 `true` 并 seal（赶工、接受剩余风险），
> 这不表示可以对外发布，剩余项见该文件与预演记录。

命令里的 `<PROD>` 是新建生产环境的 ID，形如 `cloud1-xxxxxxxxxxxxx`。
**下面每一步的顺序都在测试环境上实测过：按顺序做即可，跳过顺序会踩到第 4.6 与第 6 步的坑。**

---

## 前置：准备工具

```powershell
# 微信开发者工具 skill CLI（部署函数、回读数据库）
# 已随开发者工具安装，无需额外安装
$cli = 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd'

# CloudBase CLI（触发器、调用云函数、环境与日志）
# 已装在 .runtime（gitignore 覆盖），首次使用需 tcb login
$tcb = '.runtime\tcb-tools\node_modules\.bin\tcb.cmd'
& $tcb login          # 用开通云环境时的账号授权
& $tcb env list       # 确认能看到目标环境
```

`tcb login` 支持设备码 / Web / 腾讯云密钥 / 环境 API Key（`--cloudbase-api-key <key> -e <envId>`）四种方式。
**微信云开发环境对腾讯云账号是可见的**（2026-09-18 实测）。

---

## 步骤

### 0. 全新环境必须先建集合（2026-09-18 实测踩到）

**新建的环境是空的**：`cloud_db_read_struct --action listCollections` 回读 `collections: []`。
后果不只是「没数据」—— 连云函数的写入都会失败：
worker 定时触发器虽然注册成功，但心跳写不进去，读 `opc_settings` 直接报
`ResourceNotFound: Db or Table not exist`。

集合由**迁移流程创建**：`migration.js:30` 在 `initialize` 动作里
`for(const name of collections){ await ensureCollection(db, PREFIX+name) }`，
共 50 个 `opc_` 前缀集合。

⚠️ **`initialize` 有锁定语义**（`migration.js:29`）：
「已有不同迁移清单或业务已启用，禁止覆盖」—— 一旦用某个清单 initialize 就换不了。
因此**在确认正式数据来源之前不要 initialize**，否则等于把某个数据源钉死在该环境上。

**顺序上还有一条硬约束（本轮实测踩到，见 4.6）**：历史发票必须由 `bootstrap` 先迁移。
`bootstrap` 会先重算批次哈希、清掉发票阻碍项，再调 `initialize` 注册**处理后的**清单；
如果先手工 `initialize` 了原始清单，之后 `bootstrap` 会因为清单哈希不同被 409 拒绝，
而 seal 又要求 `readyToSeal=true` 且 `blockers` 为空 —— 于是只能把环境重置重来。

因此全新环境的正确顺序是：**配密钥 → 生成专属清单 → 部署带快照的 opc-admin → `bootstrap`
（每批 3 个批次，反复调用直到 `imported-awaiting-acceptance`）**，不要先手工 `initialize`。

当前 `test-opc-app-d3gki762bfb61da92` 的状态：50 个集合、27 批 203 条记录、历史发票、
44 条索引均已完成并回读验证，`settings.migration.status = sealed`。

### 1. 建生产环境（人工，云开发控制台）

在微信云开发控制台新建环境。建好后把环境 ID 填入下一步。

**不要**把生产环境与开发环境混用：开发库里还有迁移期快照与测试数据。

### 2. 改 `env.js` 的 production 环境

`miniprogram/config/env.js` 中把 `production` 的 `cloudEnv` 换成 `<PROD>`。
（`env.js` 已有守卫：`release` 版若仍指向开发环境会**直接拒绝启动**，所以这一步不做完就发不了正式版。）

同时把 `tests/edges.test.cjs` 中「release refuses to start while it still points at the development environment」
改为断言 release 使用新环境。

### 3. 在生产环境建查询索引

索引是每个环境各自创建的，必须在新环境重跑：

```powershell
cd D:\ITEM\zhihu-app
& .\weixin-app\scripts\apply-cloud-indexes.ps1 -EnvId <PROD>
& .\weixin-app\scripts\audit-cloud-indexes.ps1 -EnvId <PROD>
```

预期回读 `desired=44 present=44 missing=0`。写入会返回待确认任务，实测由开发者工具自动放行（约 3 秒）。
回读与进度文件都是**按环境分开**的（`index-audit-<envId>.json`、`index-apply-state-<envId>.json`、
`.runtime/cloud-indexes/<envId>/`）：`audit-cloud-indexes.ps1` 过去把开发环境 ID 写死在脚本里，
不传 `-EnvId` 会把开发环境的 44 条索引误报成新环境已就绪。

### 4. 配置云函数环境变量（人工，云开发控制台）

**变量只在云函数配置里保存，不写入仓库、小程序或聊天。**

| 函数 | 变量 |
| --- | --- |
| `opc-api` | `ZHIHU_ACCESS_TOKEN`、`ZHIHU_SECRET_KEY`、`OPC_CALLBACK_KEY`、`OPC_ZHIHU_DAILY_LIMIT`（可选，默认 1000/天） |
| `opc-worker` | `ZHIHU_ACCESS_TOKEN`、`ZHIHU_SECRET_KEY` |
| `opc-admin` | `OPC_MIGRATION_SECRET`（至少 32 位随机值）；**导入结束、seal 之后应移除** |

### 4.5 ⚠️ 全新函数必须部署两次（2026-09-18 实测踩到）

**`cloud_fn_deploy` 对尚不存在的函数，首次调用只创建函数壳，代码不会生效。**
症状非常隐蔽：`tcb fn list` 显示「部署完成」，但函数实际跑的是 CloudBase 默认模板
（`exports.main = async event => event`）—— 表现为**原样回显传入的事件、耗时仅 3ms**。

实测证据：对新环境的 `opc-worker` 传定时器事件
`{"Type":"Timer","TriggerName":"opc-jobs-every-minute"}`，首次返回事件本身（3ms）；
**再部署一次后**同一调用返回 `{"code":50300,"message":"迁移未完成，暂停后台任务"}`（326ms）。

因此在全新环境里，每个函数都要部署两次，并且**必须用一次真实调用确认它在跑自己的代码**，
不能只看「部署完成」。排查时注意：本环境日志未开启（`tcb fn log` 报 `topic not exist`），
**不能靠日志判断**，只能靠调用返回值。

### 4.6 新环境的两个前置：迁移密钥与专属清单（2026-09-18 实测）

在测试环境上执行 `initialize` 时被拒，暴露出两个必须先解决的前置：

**(1) `OPC_MIGRATION_SECRET` 必须由人工在控制台配置。**
返回 `{"code":40300,"message":"云函数未开放迁移入口"}` —— `authenticate()` 读的是
`process.env.OPC_MIGRATION_SECRET`，新环境的函数配置里没有它。
**`tcb fn env` 只有 `pull` 子命令，没有写入能力**，CLI 改不了，只能在微信云开发控制台
逐个函数配置。

**(2) 迁移清单是环境专属的，不能跨环境复用。**
`migration.js` 会校验 `manifest.environmentId === environment`，而现有
`.runtime/cloud-migration/manifest.json` 的 `environmentId` 是开发环境
`cloud1-d4g9ou4cd3b80d764`。清单里的 `environmentId` 来自
`cloudbase/deployment.json`（见 `scripts/bundle-cloud.cjs:7`），因此为新环境生成清单时
需要先让该字段指向新环境（或把脚本参数化）。

顺序：先配密钥 → 再为新环境生成清单 → **部署带迁移快照的 opc-admin 并跑 `bootstrap`** → 完成后再 `verify`。

```powershell
cd D:\ITEM\zhihu-app
node .runtime\gen-init.cjs <PROD>                     # 生成 manifest-<PROD>.json 与 init-<PROD>.json
cd weixin-app
node scripts\bundle-cloud.cjs --migration --env <PROD>  # 把目标环境清单与发票打进 opc-admin
# 用 cloud_fn_deploy 部署 .runtime/cloud-bundles/opc-admin 到 <PROD>，然后反复调用：
#   tcb fn invoke opc-admin -d "@.runtime\cloud-migration\bootstrap.json" -e <PROD>
# 事件形如 {"action":"bootstrap","secret":"<OPC_MIGRATION_SECRET>"}，每次导入 3 个批次，
# 直到返回 status=imported-awaiting-acceptance 且 verification.verified=true。
```

`bootstrap` 会：把历史发票上传到该环境云存储并回读校验哈希 → 清掉清单里的发票阻碍项 →
重算受影响批次的哈希 → `initialize` 注册处理后的清单 → 分批导入 → `verify`。
预演环境里发票对象落在 `sealed-invoices/legacy-<id>/<sha256>.pdf`，可回读存在性与哈希。

⚠️ `bundle-cloud.cjs` 不带 `--env` 时用 `cloudbase/deployment.json`（开发环境）；
目标环境清单文件是 `manifest-<envId>.json`，缺失或环境不符会直接报错，不会静默打错包。

### 5. 部署三个云函数

```powershell
cd D:\ITEM\zhihu-app\weixin-app
npm run dev:full          # 打包 + 测试 + 检查 + 生成单文件部署包
cd D:\ITEM\zhihu-app
& .\weixin-app\scripts\deploy-cloud.ps1 -Environment <PROD>
```

部署包在 `.runtime/cloud-bundles`，每个函数合成单个 `index.js`。
**部署完成不等于全部云端配置就绪**：运行时、超时、内存、触发器、权限规则都要单独核对。

替代路径（2026-09-18 实测可用，且会保留函数既有配置）：

```powershell
& $cli -c Codex cloud_fn_deploy --appid wx22b91776ccf37354 --env <PROD> `
  --path D:\ITEM\zhihu-app\.runtime\cloud-bundles\opc-api --remote-npm-install
```

⚠️ **不要用 `tcb fn deploy`**：它读 `cloudbaserc.json`，仓库没有该文件，可能把函数超时从 60 秒重置为默认值。

### 6. 上传 worker 定时触发器

**代码部署不注册触发器** —— 已实测：用 `cloud_fn_deploy` 部署 `opc-worker` 后等 100 秒仍读不到心跳。
skill CLI 也没有触发器工具，必须用 CloudBase CLI：

```powershell
& $tcb fn trigger create opc-worker --trigger-name opc-jobs-every-minute --cron "0 * * * * * *" -e <PROD>
```

`-501001`（`SYS_ERR`）以外的错误会被直接暴露；创建成功会回 `√ 创建云函数触发器成功！`。

⚠️ **触发器会"消失"，而且 CLI 没有 list 子命令**（2026-09-18 预演实测）：
测试环境的触发器曾连续每分钟触发 53 次，随后**静默停止**，`lastTriggeredAt` 停在 10:10:01Z。
判断依据只能是心跳：`tcb fn trigger` 只有 `create` / `delete`，`tcb fn detail` 也不返回触发器。
处置办法是**再 create 一次**（同名创建成功即说明此前已不存在），随后心跳立刻恢复
（runs 53 → 55，`outcome` 从 `migration-gated` 变为 `completed`）。

等 1–2 分钟后**必须回读心跳**确认：

```powershell
cd D:\ITEM\zhihu-app
& .\weixin-app\scripts\read-cloud-backend-checks.ps1 -EnvId <PROD>
& .\weixin-app\scripts\read-cloud-runtime.ps1 -EnvId <PROD>
```

预期 `worker-heartbeat.observed = true`。seal 之前 `outcome` 应为 `migration-gated`，
seal 之后应变为 `completed`（或 `failed`，此时要查 worker 错误）。

### 7. 导入正式数据

走迁移流程（`opc-admin` 的 `bootstrap` / `import` / `verify`）。
**正式数据来源必须先确认** —— 这是 `release.json` 里仍挂着的一条阻碍。
注意按第 4.6 步的顺序：**先 `bootstrap`，不要先手工 `initialize`**。
`bootstrap` 每次调用导入 3 个批次，反复调用直到 `imported-awaiting-acceptance` + `verified=true`。

### 8. 在生产环境跑隔离业务验收

```powershell
& $tcb fn invoke opc-admin -d "@.runtime\cloud-migration\console-business-check.json" -e <PROD>
```

五阶段 `seed → roles → operations → finance → cleanup`，每次调用推进一个阶段；
返回 `running`/`cleaning` 就用**同一份参数**继续，直到 `passed`。
2026-09-18 预演实测：测试环境 5 次调用走完五阶段，`status=passed`，五项 checks 全 true。

- **不要**用 `console-business-check-retry.json`（含 `restart=true`，会重置进度），除非确实要从失败中重建
- 失败时读 `diagnostic.apiDiagnostic.sdkMessage`，它已包含脱敏后的 SDK 消息
- 预期 `status=passed`，五项 checks 全 true
- 该入口过去把开发环境 ID 硬编码在 `opc-admin/index.js` 里，导致本步骤在新环境必然 403；
  现已改为「仅要求 `settings.migration.status === 'importing'`」，seal 之后仍然一律拒绝

### 8.5 存储验收（可与本步并行，seal 之后也能跑）

```powershell
& $tcb fn invoke opc-admin -d "@.runtime\cloud-migration\console-storage-check.json" -e <PROD>
```

走真实云存储的分片上传 → 合并 → 回读哈希 → 幂等重放 → 清理，用隔离命名空间，不碰迁移数据。
预期 `status=passed` 且 `objectsRemoved=true`。预演实测：1 MB / 3 分片 / 回读哈希一致 / 清理完成。

### 9. `release.ready` 置为 true 并 seal

⚠️ **这一步是产品决策**：`ready=true` 在语义上是「接口迁移和上线验收完成、接受剩余风险」。
`migration.js:73` 是硬门禁 —— `ready !== true` 或 `blockers` 非空时会拒绝 seal。

`cloudfunctions/opc-admin/release.json`（三个函数各有一份副本，保持一致）置
`{"ready": true, "blockers": []}` 后**重新打包并部署 opc-admin**，再执行 seal：

```powershell
cd D:\ITEM\zhihu-app\weixin-app
node scripts\bundle-cloud.cjs --env <PROD>     # release.json 会被打进 index.js，必须重新打包
# 用 cloud_fn_deploy 部署三个函数，然后回读确认函数里已经是新内容：
& $tcb fn invoke opc-admin -d "@.runtime\cloud-migration\verify.json" -e <PROD>   # release.ready 应为 true
```

seal 事件需要三项同时成立（`migration.js:71-74`）：

```json
{"action":"seal","secret":"<OPC_MIGRATION_SECRET>",
 "confirmation":"<settings.migration.manifestHash>","cloudAcceptanceVerified":true}
```

`confirmation` 必须是**该环境** `settings.migration.manifestHash`，猜不得；成功返回 `{"sealed":true}`。
预演实测：`sealedAt = 2026-09-18T10:18:44.605Z`。

**导入结束后要部署「不含快照」的常规管理员包**（`bundle-cloud.cjs` 不带 `--migration`），
把开发库快照从云函数里移除；迁移期间不要用常规包覆盖迁移包。

### 10. 业务写入开关

`gateway.js` 的两道门禁：`settings.migration` 必须存在且 `status === 'sealed'`（或处于预览模式），
预览模式下只放行 GET 与三个认证 POST。
`cloudfunctions/opc-api/development-access.json` 只在 `enabled === true`、`mode === 'ui-preview'`
且 `environmentId` **等于当前环境** 时生效 —— 因此它天然只锁开发环境，
封到新环境后写入自动放行，**不需要改这个文件**。

验证方式（浏览器/模拟器里跑一次真实写入探测，不产生任何写入）：

```powershell
& .\scripts\simulator-acceptance.ps1 -ProbeGateWrite   # 期望 HTTP 422/403，而不是 409
```

预演实测：seal 后同一探测从 `409 当前为 UI 测试模式` 变为 `422`（业务校验错误）＝写入已开放。

### 11. 小程序后台配置 downloadFile 合法域名（人工）

凭证下载走 `wx.downloadFile`，域名必须在小程序后台配置，否则真机失败
（开发者工具勾「不校验合法域名」不会暴露这个问题）。实测域名：

| 环境 | `downloadFile` 合法域名（临时链接的实际主机） | 云存储 CDN 域 |
| --- | --- | --- |
| 开发 `cloud1-d4g9ou4cd3b80d764` | `636c-cloud1-d4g9ou4cd3b80d764-1490018601.cos.ap-shanghai.myqcloud.com` | `636c-cloud1-d4g9ou4cd3b80d764-1490018601.tcb.qcloud.la` |
| 测试 `test-opc-app-d3gki762bfb61da92` | `7465-test-opc-app-d3gki762bfb61da92-1490018601.cos.ap-shanghai.myqcloud.com` | `7465-test-opc-app-d3gki762bfb61da92-1490018601.tcb.qcloud.la` |

生产环境换新环境后要重新取域名（`cloud_query_storage --action url --cloud-path <任意文件>`）。

### 12. 五角色端到端验收

先备账号：

```powershell
cd D:\ITEM\zhihu-app\weixin-app
$env:WEIXIN_ACCEPTANCE_PASSWORD = '<admin 密码>'
& .\scripts\provision-acceptance-accounts.ps1        # 重置达人/团长密码、补建运营/财务管理员、给项目权限
```

账号与统一密码写入 `.runtime/weixin-acceptance/accounts.local.json`（已 ignore，不进仓库）。

再在模拟器里逐角色跑页面链路（比真机便宜，先筛页面级问题）：

```powershell
foreach ($u in @('admin','test1','test2','ops001','fin001')) {
  $env:WEIXIN_ACCEPTANCE_USERNAME = $u
  # admin 用 admin 密码，其余用上面脚本设置的统一密码
  & .\scripts\simulator-acceptance.ps1
}
```

脚本按账号的 `role + adminDuty` 推出**该角色应该能进哪些页面**，无权限页要求停在原地并
`denied=true`，有权限页要求 `allowed=true`、作用域标签非空、无错误。五个角色都过一遍才算完成。

真机验收按 `docs/LOCAL-TESTING-CHECKLIST.md` 阶段 B 执行，真机必须连目标环境
（体验版走 `trial` 槽位，见 `miniprogram/config/env.js`）。

---

## 每一步的验证方式

| 步骤 | 怎么确认真的成了 |
| --- | --- |
| 3 索引 | `audit-cloud-indexes.ps1` 回读 `desired=44 present=44 missing=0` |
| 5 部署 | `tcb fn list` 看三个函数的修改时间；`tcb fn detail` 核对运行时/超时/内存 |
| 6 触发器 | `read-cloud-backend-checks.ps1` 回读 `worker-heartbeat.observed = true` |
| 8 验收 | 回读 `status=passed` 且五项 checks 全 true |
| 10 门禁 | 写入返回 200/业务错误码，而不是 409 `当前为 UI 测试模式` |
| 11 域名 | 真机点开一张付款凭证能显示出图/PDF |
| 12 真机 | 五角色各自的核心链路在真机上跑通 |

**原则：每一步都要有独立回读证据，不接受「命令退出码为 0」作为成功依据** ——
微信工具链里已多次出现退出码 0 但实际失败、以及控制台弹 `scf/Invoke -3` 而服务端实际成功的情况。
