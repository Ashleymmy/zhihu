# 知乎审核状态同步功能说明

## 功能概述

知乎推广计划和作品提交后需要经过审核，审核状态包括：
- **待审核 (pending)** - 刚提交，等待知乎审核
- **审核中 (auditing)** - 正在审核
- **已通过 (approved)** - 审核通过，可以正常推广
- **已拒绝 (rejected)** - 审核未通过，会有拒绝原因

本功能从知乎 API 定期同步审核状态和拒绝原因，并在管理员后台展示。

## 数据库变更

### 新增字段

- `plans.zhihu_status_json` - 存储从知乎返回的推广计划审核状态（JSON 格式）
- `compositions.zhihu_status_json` - 存储从知乎返回的作品审核状态（JSON 格式）

字段内容示例：
```json
{
  "status": "active",
  "auditStatus": "approved",
  "rejectReason": null
}
```

或拒绝的情况：
```json
{
  "status": "rejected",
  "auditStatus": "rejected",
  "rejectReason": "关键词不符合知乎推广规则，请更换关键词"
}
```

### 迁移文件

- `server/migrations/014_zhihu_status_json.sql` - 添加字段
- `server/migrations/014_zhihu_status_json.down.sql` - 回滚迁移

## 后端实现

### 同步任务

1. **syncPlanStatus** (`server/src/jobs/syncPlanStatus.ts`)
   - 调用知乎 `/alliance/api/popularize_plans` 接口获取推广计划列表
   - 将审核状态更新到本地 `plans.zhihu_status_json` 字段

2. **syncCompositionStatus** (`server/src/jobs/syncCompositionStatus.ts`)
   - 调用知乎 `/alliance/api/popularize_compositions` 接口获取作品列表
   - 将审核状态更新到本地 `compositions.zhihu_status_json` 字段

### 定时任务

在 `server/src/jobs/index.ts` 中注册了每天凌晨 3 点自动同步：

```typescript
// 每天凌晨 3 点同步推广计划和作品的审核状态
cron.schedule('0 3 * * *', async () => {
  await enqueue('sync-plan-status', { source: 'cron' })
  await enqueue('sync-composition-status', { source: 'cron' })
})
```

### API 端点

手动触发同步的接口（仅管理员）：

- `POST /api/v1/admin-tools/sync-plan-status` - 手动同步推广计划审核状态
- `POST /api/v1/admin-tools/sync-composition-status` - 手动同步作品审核状态

## 前端展示

### 管理员后台 - 推广计划列表

在 `apps/platform-admin/src/views/PlansView.vue` 的表格中新增了"知乎审核"列：

- 显示审核状态标签（待审核/已通过/已拒绝等）
- 如果被拒绝，显示拒绝原因
- 颜色标识：
  - 绿色 (active) - 已通过
  - 红色 (rejected) - 已拒绝
  - 灰色 (draft) - 待审核/审核中

### 系统工具 - 数据处理页面

在 `apps/platform-admin/src/views/SysDataView.vue` 新增了两个手动同步按钮：

- **推广计划审核状态** - 点击立即从知乎同步推广计划的审核状态
- **作品审核状态** - 点击立即从知乎同步作品的审核状态

## 使用流程

### 首次部署

1. **运行数据库迁移**
   ```bash
   # 开发环境
   npm run migrate
   
   # 生产环境（Docker）
   # 迁移会在容器启动时自动执行
   ```

2. **重启服务**
   ```bash
   # 开发环境
   npm run dev
   
   # 生产环境
   docker-compose restart server
   ```

### 日常使用

#### 自动同步（推荐）

系统每天凌晨 3 点自动同步，无需人工干预。

#### 手动同步

当推广计划或作品刚提交审核，想立即查看审核结果时：

1. 登录管理员后台
2. 进入「系统工具」→「数据处理与授权」
3. 点击「推广计划审核状态 - 立即同步」或「作品审核状态 - 立即同步」
4. 等待 5-10 秒后刷新页面
5. 在推广计划列表页查看"知乎审核"列的最新状态

## 常见问题

### 1. 为什么审核状态没有更新？

**原因：**
- 知乎 API 可能还没有返回审核结果（刚提交的计划需要等待）
- 同步任务还在队列中执行

**解决：**
- 等待 1-2 分钟后再次手动同步
- 检查服务日志看是否有错误

### 2. 推广计划被拒绝了怎么办？

**处理流程：**
1. 在推广计划列表查看"知乎审核"列的拒绝原因
2. 根据拒绝原因修改推广计划（通常是关键词不符合规则）
3. 删除被拒绝的计划，重新创建新计划
4. 等待知乎重新审核

### 3. 同步任务执行失败

**排查步骤：**
1. 检查知乎 API 凭证是否正确（`ZHIHU_ACCESS_TOKEN`）
2. 查看服务日志：`docker logs zhihu-app-server-1 | grep sync`
3. 确认知乎 API 是否正常（可能是知乎侧维护）

### 4. 审核状态字段为空

**可能原因：**
- 推广计划从未同步到知乎（`sync_status` 为 `local`）
- 知乎 API 返回的数据格式变化

**解决：**
- 先确保推广计划已成功同步到知乎（`sync_status` 为 `synced`）
- 检查知乎 API 文档，确认返回字段名

## 技术细节

### 数据流

```
知乎 API (popularize_plans / popularize_compositions)
    ↓
同步任务 (syncPlanStatus / syncCompositionStatus)
    ↓
本地数据库 (plans.zhihu_status_json / compositions.zhihu_status_json)
    ↓
后端 API (plans.service.ts / compositions.service.ts)
    ↓
前端展示 (PlansView.vue)
```

### 错误处理

- 同步任务失败不会阻塞其他任务
- 错误日志会记录到控制台，方便排查
- 单个计划同步失败不影响其他计划

### 性能考虑

- 使用 `page_size: 100` 批量获取，减少 API 调用次数
- 只更新有变化的记录
- 索引字段：`zhihu_plan_id`、`zhihu_composition_id`

## 未来优化

1. **实时推送**：知乎如果支持 webhook，可以在审核状态变化时主动推送
2. **历史记录**：记录审核状态的变更历史
3. **通知提醒**：当推广计划被拒绝时，自动通知负责人
4. **批量重试**：为被拒绝的计划提供批量修改和重新提交功能
