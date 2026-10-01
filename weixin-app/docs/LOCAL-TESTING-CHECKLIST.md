# 开发者工具与云端联调测试清单

**适用版本：** 2026-09-18

---

## ⚠️ 先读这一段：这个清单不是「纯本地」测试

本清单使用 **微信开发者工具 + 云端开发环境 `cloud1-d4g9ou4cd3b80d764`**。

只要小程序使用 `wx.cloud.callFunction`，**真机与模拟器的调用都必然打到某个云环境**，云函数运行在腾讯云。因此不存在「完全本地跑通、再上云」的路径。本仓库可以本地执行的是：

| 能本地做 | 位置 |
| --- | --- |
| 云函数业务逻辑（纯 Node + 内存数据库适配器） | `npm test`（108 项） |
| 语法、路由、打包一致性、页面结构 | `npm run check`、`npm run cloud:check` |
| 代码级断点调试 | 开发者工具「云函数本地调试」（代码在本机 Node 运行，**数据库仍是云端**） |

**真机测试必须连云环境。** 上线前真正要守住的分界线不是「本地 vs 云端」，而是**开发环境 vs 生产环境**——见文末「上云前检查」。

---

## 阶段划分

当前 `cloudfunctions/opc-api/development-access.json` 为：

```json
{ "enabled": true, "environmentId": "cloud1-d4g9ou4cd3b80d764", "mode": "ui-preview" }
```

该门禁下：**登录、退出、改密、读取页面数据可用；所有业务写入与直接上游读取返回 409；worker 业务作业暂停。**

因此本清单分两阶段。**阶段 B 必须先解除门禁才能执行**，否则场景会全部以 409 失败——这不是 Bug，是预期行为。

---

## 准备工作

### 1. 本地检查（不需要云环境）

```powershell
cd D:\ITEM\zhihu-app\weixin-app
npm run cloud:package   # 生成 opc-worker / opc-admin 的 lib 与 vendor 副本
npm test                # 预期 195 项全部通过
npm run check           # 预期：13 pages; JS, JSON, components, routes and WXML
npm run cloud:check     # 预期：201 registered handlers
npm run cloud:bundle    # 生成部署包到 .runtime/cloud-bundles
```

或直接 `npm run build`（会先触发 `prebuild` = 打包 + 测试）。

> 修改 `cloudfunctions/opc-api/lib` 或 `vendor` 后**必须**重新打包，否则另外两个函数仍是旧副本，`cloud:check` 会报 `Stale package`。

### 2. 开发者工具

- [ ] 导入项目目录 `D:\ITEM\zhihu-app\weixin-app`
- [ ] 确认 AppID：`wx22b91776ccf37354`
- [ ] 确认云开发环境：`cloud1-d4g9ou4cd3b80d764`（注意 `d4g9` 后是字母 `o`，不是数字 `0`）
- [ ] 如需命令行联调：主窗口 → 设置 → 安全设置 → 开启**服务端口**

### 3. 部署云函数（这是云端操作，不是本地操作）

- [ ] 右键 `cloudfunctions/opc-api` → 上传并部署：云端安装依赖
- [ ] 右键 `cloudfunctions/opc-worker` → 上传并部署：云端安装依赖
- [ ] 右键 `cloudfunctions/opc-admin` → 上传并部署：云端安装依赖
- [ ] 右键 `cloudfunctions/opc-worker` → **上传触发器**（与上传代码是两项独立操作）

> 推荐用 `.\scripts\deploy-cloud.ps1`，它会依次测试、编译、打包、检查环境再上传，避免直接上传源码目录导致的模块解析错误。注意某些开发者工具版本失败时退出码仍为 0。

---

## 阶段 A：门禁未解除时可执行的验证

### A1. 身份与会话

1. [ ] 打开小程序进入登录页
2. [ ] 输入账号密码登录

**预期：** 登录成功跳首页；token 写入 Storage；显示用户信息；会话绑定微信 OPENID，有效期 8 小时。

### A2. 页面读取

- [ ] 首页、任务、作品、数据、我的 五个 tab 均可打开
- [ ] 团队 / 项目 / 定价 / 报表 / 管理 / 提现 页面按角色显示或拒绝访问
- [ ] 无权限的页面拒绝进入

### A3. 改密与退出

- [ ] 使用临时密码登录时强制跳转改密页
- [ ] 改密成功后旧会话失效
- [ ] 退出后 token、用户、当前项目被清除
- [ ] 401 时自动清理并跳回登录

### A4. 门禁生效验证（预期失败）

- [ ] 提交作品 → 返回 **409**
- [ ] 新建关键词 → 返回 **409**
- [ ] 上传文件 prepare → 返回 **409**
- [ ] 直接调用知乎上游 → 返回 **409**

**以上 409 是正确行为。** 若其中任何一项成功写入，说明门禁失效，应立即停止测试并排查。

**阶段 A 通过标准：** A1–A3 全部成功，A4 全部返回 409。

---

## 阶段 B：解除门禁后执行（业务链路）

> 执行前需将 `development-access.json` 切到放行档位，并在测试结束后恢复。**不要手工改迁移状态绕过验收。**

### B1. 文件上传 —— 小文件（单片）

1. [ ] 进入报表页，选择 < 512 KiB 的 XLSX

**预期：** `POST /core/files/prepare` 成功 → 单片 `upload-chunk`（index=0）→ `finish-upload` → 返回文件 ID。

**验证：** 云函数日志有分片接收记录；云存储出现合并文件；前端拿到文件 ID。

### B2. 文件上传 —— 大文件（多片）

1. [ ] 选择 1–5 MiB 的 XLSX

**预期：** 按 512 KiB 分片，依次调用 `upload-chunk`（index 0,1,2…），全部成功后合并。

**验证：** 合并文件大小正确；SHA256 校验通过。（`finish-upload` 返回 `{id, size, sha256, complete:true}`）

### B3. 上传重试

1. [ ] 上传过程中断网，等待失败，再恢复网络

**预期：** 分片最多重试 3 次、合并最多重试 5 次；同一分片重试内容相同，后端返回 `received: true`。

> ⚠️ **不要在清单里期待「跳过已上传分片」。** 当前实现**没有断点续传**：循环固定从 `index = 0` 重新开始。若在最后一篇断网，重来会重传全部分片。这是已知未实现项，不要当成 Bug 记录。

### B4. 会话/项目变化检测

1. [ ] 上传过程中切换项目

**预期：** `guard` 检测到变化并中断，提示「页面或项目已变化，请重新操作」；不会写入错误项目。会话失效（`SESSION_CHANGED`）与 401 同样立即中断且不重试。

> 该行为已有自动化覆盖：`tests/upload.test.cjs` 中的「a context change between chunks…」与「a session change mid-upload…」。

### B5. 文件权限隔离

- [ ] 账号 A 上传的文件，账号 B 无法读取（403）
- [ ] 服务端 `sealed-proofs` 快照不可被客户端修改
- [ ] 用户只能上传到服务端指定路径

### B6. 报表导入

1. [ ] `POST /modules/zhihu/imports` 创建导入，携带 `{projectId, accountId, fileId}`
2. [ ] 等待 `preparing` → `preview`
3. [ ] 核对预览数据与 `previewHash`
4. [ ] `POST /modules/zhihu/imports/:id/commit`，携带 `{previewHash, requestKey}`
5. [ ] 轮询 `GET /modules/zhihu/imports/:id`

**预期：** 解析每 20 行保存进度；提交后 `processing` → worker 每任务最多 10 行、每行独立事务 → `completed`；相同来源数据不重复归因。

**验证：** cursor 递增；无错误日志；归因数据生成。

### B7. 财务确认（游标分批）

1. [ ] `GET /modules/zhihu/workbench` 取待确认项
2. [ ] `POST /modules/zhihu/workbench/confirm`，携带 `{factIds, reviewHash, acknowledged:true, requestKey}`

**验证：** `factIds` 与 `reviewHash` 匹配；同一 `requestKey` 重试不重复记账。

### B8. 资金开放

1. [ ] `GET /core/finance/funding-preview` 取候选
2. [ ] 选中 1–3 个 `incomeId` 再次取哈希
3. [ ] `POST /core/finance/funding`，携带 `{incomeIds, hash, reference, requestKey}`

**验证：** 金额计算正确；钱包余额更新；不会把已开放余额重新冻结。

### B9. 提现

1. [ ] `POST /core/finance/withdrawals` 申请
2. [ ] `POST /core/finance/withdrawals/:id/review` 审核
3. [ ] `POST /core/finance/withdrawals/:id/proof/prepare` → 上传凭证 → `POST /core/finance/withdrawals/:id/proof`

**验证：** 余额校验与精度正确；权限检查生效；凭证哈希在查看时再次核对。

**注意：** 付款登记需要流水号、日期、PNG/JPG/PDF 凭证和实际付款确认，**系统不会自动转账**。

---

## 排错

| 现象 | 可能原因 | 排查 |
| --- | --- | --- |
| 上传返回 409 | `development-access.json` 处于 `ui-preview` | 确认门禁状态；阶段 A 下这是预期行为 |
| `finish-upload` 409 | 合并租约未释放（90 秒）或并发冲突 | 等 3 秒重试；查看云函数执行时长 |
| 预览一直 `preparing` | worker 未部署或触发器未上传 | 确认 opc-worker 已部署；确认触发器已上传；可手动触发 |
| 401 未授权 | token 过期（8 小时）或会话被清理 | 检查 Storage 中 token；重新登录 |
| `FUNCTION_NOT_FOUND` | opc-api 未部署 | 先完成云端部署 |
| `Stale package` | 改了共享代码未重新打包 | `npm run cloud:package` |
| 控制台弹 `scf/Invoke -3 / UPSTREAM` | 控制台未正确反映服务端结果 | **不要据此判定失败**，以数据库回读为准 |

---

## 测试记录

- 开发者工具版本：_______
- 基础库版本：_______
- 云环境 ID：`cloud1-d4g9ou4cd3b80d764`
- 测试时间：_______

### 阶段 A

- [ ] A1 身份与会话 —— ✅ / ❌
- [ ] A2 页面读取 —— ✅ / ❌
- [ ] A3 改密与退出 —— ✅ / ❌
- [ ] A4 门禁生效（四项均 409）—— ✅ / ❌

### 阶段 B（需先解除门禁）

- [ ] B1 小文件上传 —— ✅ / ❌
- [ ] B2 大文件多片上传 —— ✅ / ❌
- [ ] B3 上传重试 —— ✅ / ❌
- [ ] B4 会话变化检测 —— ✅ / ❌
- [ ] B5 文件权限隔离 —— ✅ / ❌
- [ ] B6 报表导入全链路 —— ✅ / ❌
- [ ] B7 财务确认 —— ✅ / ❌
- [ ] B8 资金开放 —— ✅ / ❌
- [ ] B9 提现与凭证 —— ✅ / ❌

### 发现的问题

1. _______
2. _______

---

## 上云前检查

### 环境隔离（必做，当前未完成）

- [ ] `miniprogram/config/env.js` 中 **development / test / production 拆分为不同云环境**
      ⚠️ 当前三者全部指向 `cloud1-d4g9ou4cd3b80d764`，正式发布前必须处理

### 云函数

- [ ] 三个函数均已部署
- [ ] 运行时 `Nodejs16.13`，超时 60 秒，内存按 `cloudbase/deployment.json` 核对
- [ ] 环境变量仅在云函数配置中：`ZHIHU_ACCESS_TOKEN`、`ZHIHU_SECRET_KEY`、`OPC_CALLBACK_KEY`、`OPC_MIGRATION_SECRET`
- [ ] 迁移密钥在导入结束后移除

### 云数据库

- [ ] 50 个 `opc_` 集合已创建，客户端读写全部禁止（已核实）
- [x] 44 条查询索引全部创建（2026-09-18 完成，回读 `{"desired":44,"present":44,"missing":0}`）
- [ ] 索引构建完成并在真实数据量下验证查询计划

### 云存储

- [ ] 保持客户端不可读写
- [ ] 云函数分片上传、下载链路已真机实测
- [ ] 小程序后台配置 **downloadFile 合法域名**：`636c-cloud1-d4g9ou4cd3b80d764-1490018601.cos.ap-shanghai.myqcloud.com`
      （凭证下载走 `wx.downloadFile`；开发者工具勾了「不校验合法域名」不会暴露这个问题）

### 定时触发器

- [ ] `opc-worker` 触发器已上传（名称 `opc-jobs-every-minute`，Cron `0 * * * * * *`，七段含年份）
- [ ] 已观察到 `worker-heartbeat`

### 验收与发布

- [ ] 隔离业务验收跑完：`status=passed`，seed/roles/operations/finance/cleanup 全部 true
- [ ] 五角色真机端到端通过
- [ ] 正式数据来源已确认，备份恢复与监控告警就绪
- [ ] `cloudfunctions/opc-api/release.json` 的 `ready` 置为 true
