# 前端接入与文档补充记录

**实施日期：** 2026-09-18

**状态：** 代码已落地；其中前端上传链路已于 2026-09-18 在测试环境的**真实云存储**上验收通过
（`check-storage`：1 MB / 3 分片 / 合并 / 回读哈希一致 / 幂等 / 清理完成）。
本文件当时的「未完成项」多数已在新环境预演中关闭，最新状态见文末与
[../cloudbase/REHEARSAL-2026-09-18.md](../cloudbase/REHEARSAL-2026-09-18.md)。

> 本文件原名「后端服务完成总结」，曾以「✅ 全部完成」描述本轮工作。该表述已更正：
> 本轮完成的是**前端接入代码与文档**，云端真实链路一项都未验收，见文末「未完成项」。

---

## 本轮实际改动

### 1. 前端上传接入云函数分片

**文件：** `miniprogram/utils/upload.js`

- 读取 `POST /core/files/prepare` 返回的 `upload.transport`，为 `cloud-function` 时走服务端分片
- 分片 512 KiB：`ArrayBuffer` 切片 → `wx.arrayBufferToBase64` → `POST /core/files/:id/upload-chunk`
- 合并：`POST /core/files/:id/finish-upload`
- 分片失败重试 3 次、合并重试 5 次；合并遇 409 等待 3 秒再试
- 会话/项目变化由 `guard` 中断
- 体积上限：报表 10 MiB，付款凭证 5 MiB
- 保留 `transport` 非 `cloud-function` 时的客户端直传分支

**与后端契约已核对一致：** `lib/file-relay.js` 的 `descriptor()` 返回 `{transport, chunkBytes, maxBytes}`，`lib/files.js` 的 prepare 返回 `{id, cloudPath, upload}`，前端读取的字段名完全对应。

**未实现：** 断点续传。上传循环固定从 `index = 0` 开始，不查询已完成分片、不持久化进度。当前只有**同一次调用内的重试**，10 MiB 文件若在中途断网，重来需重传全部分片。后端分片是幂等的，重复上传同一片会返回 `received: true`，但前端未利用这一点。

**已修复（2026-09-18）：** 原第 135、169 行的致命错误判断存在运算符优先级问题（`error.message && A || B`，`error.message` 为空时抛 `TypeError`）。现改为按错误码判定：

```js
error.code === 'CONTEXT_CHANGED' || error.code === 'SESSION_CHANGED' || error.status === 401
```

`guard` 抛出的错误现在带 `CONTEXT_CHANGED` 码，不再依赖匹配中文文案。同时收紧了重试策略：只有网络错误、5xx、409（租约冲突）和 408 会重试，403/413/422/501 立即失败。

**同轮修复的其它缺陷：**

- `alliance-xlsx` 之前套用图片/PDF 选择器且限制 5 MiB，与后端 `maxBytes()` 给它的 10 MiB 不一致；现按 XLSX 处理，与 `report` 同档
- `finish-upload` 返回缺少 `id` 时原先会返回 `undefined` 作为文件 ID，现在明确报错且不重试
- 空文件此前会走完整个 prepare 流程才失败，现在提前拒绝

### 2. 文档

| 文件 | 实际内容 | 曾被写成 |
| --- | --- | --- |
| `docs/API-REFERENCE.md` | **50 个**接口 | 「201 个接口完整参考」 |
| `docs/FRONTEND-INTEGRATION.md` | 12 个章节、27 个代码块 | 一致 |

云端共注册 **201 个**处理器（`npm run cloud:check` 可复核），API 参考文档覆盖其中 **50 个（约 25%）**，且未逐接口列出权限要求与错误码。「201 个接口完整参考」不成立。

### 3. 开发脚本

`package.json` 新增：

```json
{
  "dev": "npm run cloud:package && npm test",
  "dev:full": "npm run cloud:package && npm test && npm run cloud:check && npm run cloud:bundle",
  "prebuild": "npm run cloud:package && npm test",
  "build": "npm run cloud:check && npm run cloud:bundle"
}
```

`npm run build` 会先触发 `prebuild`，顺序为：打包共享代码 → 测试 → 检查 → 生成部署包。

### 4. 测试 —— 关于「新增 51 项」

本轮新增两个测试文件，**已于同日晚些时候全部删除**：

- `tests/frontend-workflow.test.cjs`（35 项）：全文只 `require('node:test')` 与 `node:assert`，**未引入任何业务模块**。写法是在测试内自行定义被测函数再断言该函数，例如：

  ```js
  test('import progress polling stops on completion or failure', () => {
    const shouldContinuePolling = (status) => status === 'processing'  // 测试内自定义
    assert.ok(shouldContinuePolling('processing'))                     // 断言自己刚写的函数
  })
  ```

- `tests/frontend-upload.test.cjs`（16 项）：仅 1 项加载了产品代码（一个 `typeof` 检查），其余断言常量与字面量对象。

这两组测试无法因产品缺陷而失败，会把测试数从 108 抬到 159 而不增加任何真实覆盖，**且恰好没有覆盖本轮新写的 `upload.js`**（上述优先级缺陷即为其一）。已删除。

**删除后的真实数字：**

```bash
npm test
```

- 测试总数：**195 项**
- 通过：**195 项**
- 失败：0 项

其中 **16 项为 `tests/upload.test.cjs`**，用 `tests/harness.cjs` 以 `vm` 加载真实的 `miniprogram/utils/upload.js` 并模拟云端三个接口，覆盖：单片/多片分片与索引、分片内容可还原为原始字节、分片载荷不超过云端 720 KiB 预算、5xx 重试且内容一致、413 不重试、会话失效不重试、上传中切换项目立即中断且不合并、409 合并租约等待后恢复、响应缺 id 报错、超限提前拒绝、`alliance-xlsx` 与 `payment-proof` 的选择器与上限、向后兼容直传、空文件与取消选择。

前端上传逻辑此前**没有**任何有效覆盖——被删除的那 51 项假测试恰好"覆盖"着它却什么都没测。

---

## 未完成项（2026-09-18 晚更新）

本节原先列的 7 项，其中 5 项已在测试环境的上线预演中关闭；下表左列为当时状态，右列为**当前**状态与判据。

| 项 | 当时 | 当前 |
| --- | --- | --- |
| isolated 业务验收 | 停在 `running/roles`，finance 50000 原因未明 | **已通过**：根因是 `TransactionBusy` 未被当作可重试；五阶段全 true |
| 前端上传链路真实验收 | 从未在云端执行过 | **已在真实云存储跑通**：`check-storage` 9 项检查全 true，含隔离性与清理 |
| 定时触发器 | 需人工上传，未观察到心跳 | **已落地并回读**：心跳每分钟一次，seal 后 `outcome=completed`（注意触发器等会静默消失） |
| 查询索引 | 3/44 | **44/44**，回读 `desired=44 present=44 missing=0`（两个环境各自建） |
| 业务门禁 | `ui-preview`，写入 409 | 测试环境**已 seal**，写入探测变 422；开发环境仍保持预览模式 |
| 真机五角色端到端 | 未开始 | **模拟器已覆盖**（五角色各 12/12，按角色校验允许与拒绝）；**真机仍未做** |
| 正式环境拆分 | 三环境同一个云环境 | 已拆出独立测试环境并接入 `trial`；**正式生产环境仍未建立**，`release` 版继续被守卫拒绝启动 |

仍未完成（上线前必须补齐）：正式生产环境、五角色真机验收与 `downloadFile` 合法域名配置、
大账户容量与生产恢复演练。这些都不是代码问题，逐项说明见
[../cloudbase/REHEARSAL-2026-09-18.md](../cloudbase/REHEARSAL-2026-09-18.md) 文末。

---

## 相关文档

- 接口清单：`docs/API-REFERENCE.md`（50 个，待补全）
- 前端接入示例：`docs/FRONTEND-INTEGRATION.md`
- 本地/模拟器测试与上云前检查：`docs/LOCAL-TESTING-CHECKLIST.md`
- 迁移交接与待办顺序：`cloudbase/HANDOFF-2026-09-18.md`
- 控制台操作清单：`cloudbase/MORNING-CHECKLIST.md`
