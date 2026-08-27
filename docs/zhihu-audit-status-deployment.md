# 知乎审核状态同步 - 部署清单

## ✅ 已完成的工作

### 1. 数据库迁移
- [x] `server/migrations/014_zhihu_status_json.sql` - 添加审核状态字段
- [x] `server/migrations/014_zhihu_status_json.down.sql` - 回滚迁移

### 2. 后端任务
- [x] `server/src/jobs/syncPlanStatus.ts` - 推广计划审核状态同步任务
- [x] `server/src/jobs/syncCompositionStatus.ts` - 作品审核状态同步任务
- [x] `server/src/jobs/index.ts` - 注册任务 + 定时调度（每天凌晨 3 点）

### 3. 后端 API
- [x] `POST /api/v1/admin-tools/sync-plan-status` - 手动同步推广计划审核状态
- [x] `POST /api/v1/admin-tools/sync-composition-status` - 手动同步作品审核状态
- [x] `server/src/routes/admin-tools.ts` - 添加两个新端点

### 4. 前端类型定义
- [x] `packages/shared-contracts/src/dto.ts`
  - Plan 接口添加 `zhihuStatusJson` 字段
  - Composition 接口添加 `zhihuStatusJson` 字段

### 5. 前端展示
- [x] `apps/platform-admin/src/views/PlansView.vue`
  - 推广计划列表新增"知乎审核"列
  - 显示审核状态标签和拒绝原因
  - 状态标签带颜色（绿色=通过，红色=拒绝，灰色=待审核）

- [x] `apps/platform-admin/src/views/SysDataView.vue`
  - 数据处理页面新增两个手动同步按钮
  - 点击后触发后端同步任务

### 6. 文档
- [x] `docs/zhihu-audit-status-sync.md` - 完整功能说明文档

## 📋 部署步骤

### 生产环境（推荐）

```bash
# 1. 拉取代码
cd /path/to/zhihu-app
git pull origin main

# 2. 构建并重启容器（自动执行迁移）
docker-compose up -d --build

# 3. 验证迁移成功
docker exec -it zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc \
  -e "SHOW COLUMNS FROM plans LIKE 'zhihu_status_json';"

# 4. 查看服务日志
docker logs -f zhihu-app-server-1 | grep "sync-plan-status\|sync-composition-status"

# 5. 首次手动同步（可选）
# 登录管理员后台 → 系统工具 → 数据处理 → 点击同步按钮
```

### 开发环境

```bash
# 1. 安装依赖（如有新包）
npm install

# 2. 运行数据库迁移
npm run migrate

# 3. 启动开发服务
npm run dev

# 4. 访问管理员后台
# http://localhost:5173/admin/system/data
```

## 🧪 测试验证

### 1. 数据库验证

```sql
-- 检查字段是否添加成功
SHOW COLUMNS FROM plans LIKE 'zhihu_status_json';
SHOW COLUMNS FROM compositions LIKE 'zhihu_status_json';

-- 预期输出：
-- Field: zhihu_status_json
-- Type: text
-- Null: YES
```

### 2. 任务注册验证

```bash
# 查看服务启动日志，应该看到任务注册信息
docker logs zhihu-app-server-1 | grep "registerJob"
```

### 3. 手动同步测试

**测试推广计划审核状态同步：**

1. 登录管理员后台：`https://your-domain.com/admin`
2. 进入「系统工具」→「数据处理与授权」
3. 找到"推广计划审核状态"，点击「立即同步」按钮
4. 等待提示"同步任务已入队，稍后自动刷新"
5. 6 秒后页面会自动刷新（可手动刷新）
6. 进入「推广计划」页面，查看"知乎审核"列是否有数据

**测试作品审核状态同步：**

1. 在「数据处理与授权」页面
2. 找到"作品审核状态"，点击「立即同步」按钮
3. 同样等待同步完成

### 4. 前端展示验证

**推广计划列表：**

1. 进入「推广计划」页面
2. 检查表格是否有"知乎审核"列
3. 如果有已同步的计划，应该看到：
   - ✅ 已通过（绿色标签）
   - ❌ 已拒绝（红色标签，下方显示拒绝原因）
   - ⏳ 待审核（灰色标签）
   - 或显示"—"（表示还未同步）

### 5. 定时任务验证

等待到凌晨 3 点，或手动触发测试：

```bash
# 方法 1：修改 cron 表达式为几分钟后执行，重启服务
# 方法 2：使用 Bull Board 查看任务队列（如已配置）
# 方法 3：直接调用 API 端点测试
curl -X POST http://localhost:3000/api/v1/admin-tools/sync-plan-status \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

## ⚠️ 注意事项

### 1. 知乎 API 限流

- 知乎 API 有调用频率限制
- 建议不要频繁手动同步（每次间隔至少 5 分钟）
- 自动同步每天只运行一次（凌晨 3 点）

### 2. 数据一致性

- 只有 `sync_status = 'synced'` 的计划才会有审核状态
- 本地创建但未同步到知乎的计划，审核状态字段为空

### 3. 错误处理

- 同步失败会记录到日志，但不会影响其他功能
- 如果知乎 API 返回格式变化，需要更新解析逻辑

### 4. 性能影响

- 同步任务在后台队列执行，不影响前台响应速度
- 数据库查询已优化（使用索引字段）

## 🐛 故障排查

### 问题 1：点击同步按钮后没有反应

**排查：**
```bash
# 查看服务日志
docker logs zhihu-app-server-1 | tail -50

# 检查 Redis 队列是否正常
docker exec -it zhihu-app-redis-1 redis-cli ping
```

### 问题 2：审核状态始终为空

**可能原因：**
1. 推广计划未同步到知乎（`sync_status != 'synced'`）
2. 知乎 API 凭证错误
3. 知乎 API 返回格式变化

**排查：**
```bash
# 检查环境变量
docker exec zhihu-app-server-1 env | grep ZHIHU

# 手动测试知乎 API
curl -X GET "https://open.zhihu.com/alliance/api/popularize_plans?page=1&page_size=10" \
  -H "Authorization: Bearer YOUR_ZHIHU_TOKEN"
```

### 问题 3：定时任务没有执行

**排查：**
```bash
# 检查 cron 任务是否注册
docker logs zhihu-app-server-1 | grep "cron.schedule"

# 查看服务器时区
docker exec zhihu-app-server-1 date

# 检查 config.timezone 设置
docker exec zhihu-app-server-1 cat dist/src/config.js | grep timezone
```

## 📊 监控建议

### 1. 日志监控

关键日志关键词：
- `syncPlanStatus: 更新了` - 成功更新了多少个计划
- `syncCompositionStatus: 更新了` - 成功更新了多少个作品
- `syncPlanStatus 失败` - 同步失败
- `syncCompositionStatus 失败` - 同步失败

### 2. 数据库监控

```sql
-- 查看有多少计划有审核状态
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN zhihu_status_json IS NOT NULL THEN 1 ELSE 0 END) as with_status
FROM plans WHERE zhihu_plan_id IS NOT NULL;

-- 查看审核状态分布（需解析 JSON）
SELECT 
  JSON_EXTRACT(zhihu_status_json, '$.auditStatus') as audit_status,
  COUNT(*) as count
FROM plans 
WHERE zhihu_status_json IS NOT NULL
GROUP BY audit_status;
```

### 3. 告警设置（可选）

- 当同步任务连续 3 次失败时发送告警
- 当被拒绝的计划数量超过阈值时通知相关人员

## 📝 变更记录

- **2025-01-XX**：初始版本，实现推广计划和作品审核状态同步功能
