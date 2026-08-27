# 知乎审核状态同步 - 功能验证清单

## 📋 部署前检查

### 数据库迁移文件
- [x] `server/migrations/014_zhihu_status_json.sql` - 添加字段
- [x] `server/migrations/014_zhihu_status_json.down.sql` - 回滚脚本

### 后端代码
- [x] `server/src/jobs/syncPlanStatus.ts` - 推广计划同步任务
- [x] `server/src/jobs/syncCompositionStatus.ts` - 作品同步任务
- [x] `server/src/jobs/index.ts` - 任务注册和定时调度
- [x] `server/src/routes/admin-tools.ts` - API 端点
- [x] `server/src/zhihu/allianceEndpointRegistry.ts` - 添加 GET /popularize_plans 端点

### 前端代码
- [x] `packages/shared-contracts/src/dto.ts` - 类型定义
- [x] `apps/platform-admin/src/views/PlansView.vue` - 推广计划列表展示
- [x] `apps/platform-admin/src/views/SysDataView.vue` - 手动同步按钮

### 文档
- [x] `docs/zhihu-audit-status-sync.md` - 功能说明
- [x] `docs/zhihu-audit-status-deployment.md` - 部署指南
- [x] `docs/FEATURE-ZHIHU-AUDIT-STATUS.md` - 功能概览
- [x] `test-audit-status-sync.sh` - 测试脚本

## ✅ 部署后验证

### 第 1 步：数据库验证

```sql
-- 1.1 检查字段是否添加成功
SHOW COLUMNS FROM plans LIKE 'zhihu_status_json';
SHOW COLUMNS FROM compositions LIKE 'zhihu_status_json';

-- 预期输出：
-- Field: zhihu_status_json
-- Type: text
-- Null: YES
-- Key: 
-- Default: NULL
-- Extra: 
```

### 第 2 步：服务启动验证

```bash
# 2.1 检查服务是否正常启动
docker logs zhihu-app-server-1 | grep "Server started"

# 2.2 检查任务是否注册成功
docker logs zhihu-app-server-1 | grep "registerJob"

# 预期看到：
# - sync-plan-status
# - sync-composition-status
```

### 第 3 步：API 端点验证

```bash
# 3.1 测试推广计划审核状态同步端点
curl -X POST http://localhost:3000/api/v1/admin-tools/sync-plan-status \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"

# 预期响应：
# {
#   "success": true,
#   "data": {
#     "jobId": "sync-plan-status-manual-1234567890",
#     "message": "推广计划审核状态同步任务已加入队列"
#   }
# }

# 3.2 测试作品审核状态同步端点
curl -X POST http://localhost:3000/api/v1/admin-tools/sync-composition-status \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"

# 预期响应：
# {
#   "success": true,
#   "data": {
#     "jobId": "sync-composition-status-manual-1234567890",
#     "message": "作品审核状态同步任务已加入队列"
#   }
# }
```

### 第 4 步：任务执行验证

```bash
# 4.1 查看任务执行日志
docker logs -f zhihu-app-server-1 | grep "syncPlanStatus\|syncCompositionStatus"

# 预期看到：
# syncPlanStatus: 更新了 X/Y 个推广计划状态
# 或
# syncPlanStatus: 无已同步的推广计划
# 或
# syncPlanStatus 失败: [错误信息]

# 4.2 检查数据库数据是否更新
docker exec -i zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc <<EOF
SELECT 
  id, 
  keyword, 
  zhihu_plan_id,
  zhihu_status_json,
  DATE(updated_at) as updated_date
FROM plans 
WHERE zhihu_status_json IS NOT NULL
LIMIT 5;
EOF

# 预期看到 zhihu_status_json 字段有 JSON 数据
```

### 第 5 步：前端展示验证

#### 5.1 推广计划列表页面

1. 登录管理员后台：`http://localhost:5173/admin`
2. 进入「推广计划」页面
3. 检查表格列：
   - [ ] 是否有"知乎审核"列
   - [ ] 状态标签是否显示正确
     - 绿色 = 已通过
     - 红色 = 已拒绝
     - 灰色 = 待审核/审核中
   - [ ] 拒绝原因是否显示（如果有）

#### 5.2 系统工具页面

1. 进入「系统工具」→「数据处理与授权」
2. 检查同步按钮：
   - [ ] 是否有"推广计划审核状态"同步按钮
   - [ ] 是否有"作品审核状态"同步按钮
   - [ ] 点击按钮后是否有"同步任务已入队"提示
   - [ ] 按钮是否在 syncing 时禁用

### 第 6 步：定时任务验证

```bash
# 6.1 查看定时任务配置
docker exec zhihu-app-server-1 cat dist/src/jobs/index.js | grep "0 3"

# 预期看到：
# '0 3 * * *'  (每天凌晨 3 点)

# 6.2 等到凌晨 3 点，查看是否自动执行
docker logs zhihu-app-server-1 | grep "$(date +%Y-%m-%d)" | grep "syncPlanStatus\|syncCompositionStatus"
```

## 🐛 常见问题排查

### 问题 1：数据库字段未添加

**症状：**
```
Error: Unknown column 'zhihu_status_json' in 'field list'
```

**解决：**
```bash
# 手动运行迁移
docker exec zhihu-app-server-1 node dist/scripts/migrate.js

# 或重启容器（会自动迁移）
docker-compose restart server
```

### 问题 2：同步任务未执行

**症状：**
- 点击同步按钮后，数据库 `zhihu_status_json` 仍为空
- 日志中没有 `syncPlanStatus` 相关信息

**排查：**
```bash
# 1. 检查 Redis 是否正常
docker exec zhihu-app-redis-1 redis-cli ping

# 2. 检查队列是否阻塞
docker exec zhihu-app-redis-1 redis-cli LLEN bull:default:wait

# 3. 查看完整错误日志
docker logs zhihu-app-server-1 | tail -100
```

### 问题 3：知乎 API 调用失败

**症状：**
```
syncPlanStatus 失败: Request failed with status code 401
```

**排查：**
```bash
# 1. 检查知乎 API 凭证
docker exec zhihu-app-server-1 env | grep ZHIHU

# 预期看到：
# ZHIHU_ACCESS_TOKEN=your_token
# ZHIHU_SECRET_KEY=your_key

# 2. 手动测试知乎 API
curl -X GET "https://open.zhihu.com/alliance/api/popularize_plans?page=1&page_size=10" \
  -H "Authorization: Bearer YOUR_ZHIHU_TOKEN"
```

### 问题 4：前端显示异常

**症状：**
- 推广计划列表看不到"知乎审核"列
- 或列显示但数据为空

**排查：**
1. 检查浏览器控制台是否有错误
2. 检查 API 响应是否包含 `zhihuStatusJson` 字段
3. 清除浏览器缓存并刷新
4. 检查前端代码是否正确引用了 `zhihuStatusJson` 字段

## 📊 性能验证

### 同步性能测试

```bash
# 测试 100 个推广计划的同步时间
time docker exec zhihu-app-server-1 node -e "
const { syncPlanStatus } = require('./dist/src/jobs/syncPlanStatus.js');
syncPlanStatus().then(() => console.log('Done')).catch(console.error);
"

# 预期：
# - 小于 5 秒（100 条以内）
# - 数据库查询次数：2 + N（N = 需要更新的计划数）
```

### 数据库性能

```sql
-- 检查是否有索引
SHOW INDEX FROM plans WHERE Column_name = 'zhihu_plan_id';

-- 检查查询性能
EXPLAIN SELECT id, zhihu_plan_id, keyword 
FROM plans 
WHERE zhihu_plan_id IS NOT NULL AND status <> 'ended';
```

## ✅ 验证通过标准

所有以下项目都应该通过：

- [x] 数据库字段添加成功
- [x] 服务正常启动，无错误日志
- [x] API 端点返回 202 状态码和正确的响应体
- [x] 任务执行后数据库有数据更新
- [x] 前端推广计划列表显示"知乎审核"列
- [x] 前端系统工具页面有同步按钮
- [x] 点击同步按钮后提示正确
- [x] 定时任务配置正确
- [x] 日志中无错误或异常

## 🎉 验证完成

如果以上所有项目都通过，说明功能部署成功！

### 后续步骤

1. **通知团队成员** - 告知新功能上线
2. **监控运行** - 观察定时任务是否每天正常执行
3. **收集反馈** - 听取用户对审核状态展示的建议
4. **优化迭代** - 根据实际使用情况优化功能

### 监控建议

```bash
# 设置每日监控脚本（可选）
cat > /etc/cron.daily/check-audit-sync <<'EOF'
#!/bin/bash
LOG_FILE="/var/log/zhihu-audit-sync-check.log"
docker logs zhihu-app-server-1 | grep "$(date +%Y-%m-%d)" | grep "syncPlanStatus" >> "$LOG_FILE"
if ! grep -q "syncPlanStatus: 更新了" "$LOG_FILE"; then
  echo "WARNING: syncPlanStatus may have failed on $(date)" | mail -s "Zhihu Audit Sync Alert" admin@example.com
fi
EOF
chmod +x /etc/cron.daily/check-audit-sync
```
