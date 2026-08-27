# 知乎审核状态同步功能

## 🎯 功能说明

自动从知乎开放平台同步推广计划和作品的审核状态，包括：
- ✅ **审核通过** - 可以正常推广
- ❌ **审核拒绝** - 显示拒绝原因，需要修改后重新提交
- ⏳ **待审核** - 等待知乎审核中

## 📦 包含文件

### 后端
- `server/migrations/014_zhihu_status_json.sql` - 数据库迁移
- `server/src/jobs/syncPlanStatus.ts` - 推广计划状态同步任务
- `server/src/jobs/syncCompositionStatus.ts` - 作品状态同步任务
- `server/src/jobs/index.ts` - 定时任务调度（每天凌晨 3 点）
- `server/src/routes/admin-tools.ts` - 手动同步 API 端点

### 前端
- `packages/shared-contracts/src/dto.ts` - 类型定义更新
- `apps/platform-admin/src/views/PlansView.vue` - 推广计划列表展示审核状态
- `apps/platform-admin/src/views/SysDataView.vue` - 系统工具页面添加同步按钮

### 文档
- `docs/zhihu-audit-status-sync.md` - 详细功能说明
- `docs/zhihu-audit-status-deployment.md` - 部署和测试指南

## 🚀 快速开始

### 1. 部署（生产环境）

```bash
# 拉取最新代码
git pull origin main

# 重启容器（自动执行迁移）
docker-compose up -d --build

# 验证
docker logs zhihu-app-server-1 | grep "zhihu_status_json"
```

### 2. 首次同步

1. 登录管理员后台
2. 进入「系统工具」→「数据处理与授权」
3. 点击「推广计划审核状态 - 立即同步」
4. 等待 5-10 秒
5. 进入「推广计划」查看"知乎审核"列

### 3. 查看效果

在推广计划列表的"知乎审核"列可以看到：
- 绿色标签：已通过
- 红色标签：已拒绝（下方显示拒绝原因）
- 灰色标签：待审核/审核中
- `—`：未同步或暂无状态

## ⏰ 自动同步

系统每天凌晨 3 点自动执行同步，无需手动操作。

## 🔧 手动同步

当需要立即查看最新审核状态时：

**方式 1：管理员后台**
- 系统工具 → 数据处理 → 点击同步按钮

**方式 2：API 调用**
```bash
curl -X POST https://your-domain.com/api/v1/admin-tools/sync-plan-status \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## 📊 数据结构

新增数据库字段：
- `plans.zhihu_status_json` - 推广计划审核状态（TEXT, JSON）
- `compositions.zhihu_status_json` - 作品审核状态（TEXT, JSON）

字段内容示例：
```json
{
  "status": "active",
  "auditStatus": "approved",
  "rejectReason": null
}
```

拒绝情况：
```json
{
  "status": "rejected",
  "auditStatus": "rejected",
  "rejectReason": "关键词不符合知乎推广规则，请更换关键词"
}
```

## 🐛 故障排查

### 审核状态为空？

1. 确认推广计划已同步到知乎（`sync_status = 'synced'`）
2. 手动触发一次同步
3. 检查服务日志：`docker logs zhihu-app-server-1 | grep sync-plan-status`

### 同步失败？

1. 检查知乎 API 凭证：`docker exec zhihu-app-server-1 env | grep ZHIHU`
2. 查看错误日志：`docker logs zhihu-app-server-1 | tail -50`
3. 确认知乎 API 是否正常

## 📚 详细文档

- [功能说明](./zhihu-audit-status-sync.md) - 完整功能介绍和使用说明
- [部署指南](./zhihu-audit-status-deployment.md) - 详细的部署步骤和测试方法

## 💡 使用场景

### 场景 1：推广计划被拒绝
1. 在推广计划列表查看拒绝原因
2. 根据原因修改（通常是关键词问题）
3. 删除被拒绝的计划
4. 重新创建新计划

### 场景 2：批量检查审核状态
1. 创建多个推广计划后
2. 等待 10-30 分钟（知乎审核时间）
3. 手动同步审核状态
4. 批量查看哪些通过、哪些被拒绝

### 场景 3：定期监控
- 系统每天自动同步
- 管理员可以定期查看是否有新的拒绝情况
- 及时通知相关负责人处理

## ⚙️ 技术细节

### API 端点
- 知乎推广计划列表：`GET /alliance/api/popularize_plans`（需分页，最多 100 条/页）
- 知乎作品列表：`GET /alliance/api/popularize_compositions`（需分页，最多 100 条/页）

### 任务调度
- 使用 `node-cron` 实现定时任务
- 使用 `Bull` 队列管理异步任务
- 定时表达式：`0 3 * * *`（每天凌晨 3 点）

### 错误处理
- 单个计划同步失败不影响其他计划
- 错误记录到日志，方便排查
- API 调用失败会自动重试（Bull 队列机制）

## 🔜 未来优化

- [ ] 实时推送：知乎 webhook 支持后实现
- [ ] 历史记录：记录审核状态变更历史
- [ ] 通知提醒：审核拒绝时自动通知负责人
- [ ] 批量操作：为被拒绝的计划提供批量修改功能
