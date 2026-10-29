# 知乎审核状态同步功能 - 部署指南

## 🚀 快速部署（生产环境）

### 第一步：拉取代码并重启服务

```bash
# 1. SSH 登录到云服务器
ssh user@your-server.com

# 2. 进入项目目录
cd /path/to/zhihu-app

# 3. 拉取最新代码
git pull origin main

# 4. 重启容器（自动执行数据库迁移）
docker-compose down
docker-compose up -d --build

# 5. 查看启动日志（确认迁移成功）
docker logs zhihu-app-server-1 | tail -n 50
```

**预期输出**：
```
✓ Migration 014_zhihu_status_json.sql applied successfully
✓ Server started on port 3000
✓ Scheduler started
```

### 第二步：验证功能

#### 2.1 检查数据库字段

```bash
docker exec -i zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc -e "
DESCRIBE plans;" | grep zhihu_status_json
```

**预期输出**：
```
zhihu_status_json    text    YES        NULL
```

#### 2.2 手动触发首次同步

1. 浏览器访问：`https://your-domain.com/admin`
2. 登录管理员账号
3. 左侧菜单 → 系统工具 → 数据处理
4. 点击「推广计划审核状态 - 立即同步」按钮
5. 等待同步完成提示

#### 2.3 查看同步结果

1. 左侧菜单 → 推广计划
2. 查看「知乎审核」列
3. 应该看到审核状态标签：
   - ✅ 已通过（绿色）
   - ❌ 已拒绝（红色）
   - ⏳ 待审核（灰色）

### 第三步：验证定时任务

```bash
# 查看定时任务日志（等待第二天凌晨 3 点后执行）
docker logs -f zhihu-app-server-1 | grep "sync-plan-status"
```

**预期输出**：
```
[2025-01-XX 03:00:00] Job sync-plan-status started
[2025-01-XX 03:00:01] Synced 5 plans
[2025-01-XX 03:00:01] Job sync-plan-status completed
```

---

## 🔍 故障排查

### 问题 1：迁移未执行

**症状**：查询 `zhihu_status_json` 字段报错

**解决**：
```bash
# 手动执行迁移
docker exec -i zhihu-app-server-1 node dist/scripts/migrate.js

# 查看迁移状态
docker exec -i zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc -e "
SELECT * FROM schema_migrations ORDER BY id DESC LIMIT 5;"
```

### 问题 2：同步按钮点击无响应

**症状**：点击同步按钮后没有任何提示

**排查**：
```bash
# 1. 查看后端日志
docker logs zhihu-app-server-1 | tail -n 100

# 2. 检查网络请求（浏览器 F12 开发者工具 → Network）
# 应该看到 POST /api/v1/admin-tools/sync-plan-status 请求

# 3. 检查队列状态
docker exec -i zhihu-app-server-1 redis-cli LLEN bull:default:wait
```

**解决**：
- 如果后端报错，检查 `.env` 中的 `ZHIHU_ACCESS_TOKEN` 配置
- 如果队列堆积，重启 Redis：`docker-compose restart redis`

### 问题 3：审核状态不显示

**症状**：推广计划列表中没有「知乎审核」列

**排查**：
```bash
# 1. 检查数据库中是否有数据
docker exec -i zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc -e "
SELECT id, keyword, zhihu_status_json FROM plans WHERE zhihu_status_json IS NOT NULL LIMIT 5;"

# 2. 检查前端构建
docker logs zhihu-app-server-1 | grep "platform-admin"

# 3. 清除浏览器缓存，强制刷新（Ctrl + Shift + R）
```

**解决**：
- 如果数据库为空，手动触发同步
- 如果前端未更新，重新构建：`docker-compose up -d --build`

### 问题 4：定时任务未执行

**症状**：第二天凌晨 3 点后仍无同步日志

**排查**：
```bash
# 1. 检查调度器是否启动
docker logs zhihu-app-server-1 | grep "Scheduler started"

# 2. 检查服务器时区
docker exec -i zhihu-app-server-1 date

# 3. 手动测试任务
docker exec -i zhihu-app-server-1 node -e "
const { enqueue } = require('./dist/src/queue');
enqueue('sync-plan-status', { source: 'manual' }).then(() => console.log('OK'));
"
```

**解决**：
- 如果调度器未启动，检查 `config.scheduler.enabled` 配置
- 如果时区不对，修改 `TZ=Asia/Shanghai` 环境变量
- 如果手动测试失败，检查 Redis 连接

---

## 📊 监控和维护

### 日常监控

```bash
# 1. 查看最近一次同步时间
docker exec -i zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc -e "
SELECT MAX(updated_at) as last_sync FROM plans WHERE zhihu_status_json IS NOT NULL;"

# 2. 统计审核状态分布
docker exec -i zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc -e "
SELECT 
  JSON_EXTRACT(zhihu_status_json, '$.auditStatus') as audit_status,
  COUNT(*) as count
FROM plans 
WHERE zhihu_status_json IS NOT NULL 
GROUP BY audit_status;"

# 3. 查看被拒绝的计划
docker exec -i zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc -e "
SELECT 
  id, keyword,
  JSON_EXTRACT(zhihu_status_json, '$.rejectReason') as reject_reason
FROM plans 
WHERE JSON_EXTRACT(zhihu_status_json, '$.auditStatus') = 'rejected';"
```

### 定期维护

**每周**：
- 检查定时任务执行日志
- 查看被拒绝计划的原因统计
- 清理过期日志

**每月**：
- 分析审核通过率趋势
- 优化关键词选择策略
- 更新文档

### 性能优化

```bash
# 1. 如果推广计划数量 > 1000，调整批次大小
# 编辑 server/src/jobs/syncPlanStatus.ts
# 将 pageSize: 100 改为 pageSize: 200

# 2. 如果同步耗时过长，增加并发数
# 编辑 server/src/jobs/syncPlanStatus.ts
# 添加并发控制逻辑（使用 Promise.all 批量处理）

# 3. 监控 Redis 内存使用
docker exec -i zhihu-app-server-1 redis-cli INFO memory | grep used_memory_human
```

---

## 📚 相关文档

- **功能概览**：[docs/FEATURE-ZHIHU-AUDIT-STATUS.md](docs/FEATURE-ZHIHU-AUDIT-STATUS.md)
- **详细说明**：[docs/zhihu-audit-status-sync.md](docs/zhihu-audit-status-sync.md)
- **验证清单**：[docs/VERIFICATION-CHECKLIST.md](docs/VERIFICATION-CHECKLIST.md)
- **快速参考**：[docs/QUICK-REFERENCE.md](docs/QUICK-REFERENCE.md)
- **实现总结**：[docs/IMPLEMENTATION-SUMMARY.md](docs/IMPLEMENTATION-SUMMARY.md)

---

## 🆘 紧急回滚

如果新功能出现严重问题，可以快速回滚：

```bash
# 1. 回滚代码
git revert HEAD

# 2. 回滚数据库
docker exec -i zhihu-app-server-1 mysql -uzhihu -pzhihu_local_password zhihu_koc < server/migrations/014_zhihu_status_json.down.sql

# 3. 重启服务
docker-compose restart server

# 4. 清理队列中的同步任务
docker exec -i zhihu-app-server-1 redis-cli DEL bull:default:sync-plan-status
docker exec -i zhihu-app-server-1 redis-cli DEL bull:default:sync-composition-status
```

---

## ✅ 部署检查清单

部署前：
- [ ] 备份数据库
- [ ] 检查知乎 API Token 有效性
- [ ] 确认服务器磁盘空间充足

部署中：
- [ ] 拉取最新代码
- [ ] 构建并重启容器
- [ ] 查看启动日志无错误

部署后：
- [ ] 验证数据库迁移成功
- [ ] 手动触发首次同步
- [ ] 确认前端显示正常
- [ ] 等待定时任务自动执行

---

**部署时间**：预计 5-10 分钟  
**回滚时间**：预计 2-3 分钟  
**影响范围**：无停机，平滑升级
