# 知乎审核状态同步 - 快速参考

## 🚀 快速命令

### 部署
```bash
git pull && docker-compose up -d --build
```

### 手动同步
```bash
# 推广计划审核状态
curl -X POST http://localhost:3000/api/v1/admin-tools/sync-plan-status \
  -H "Authorization: Bearer $TOKEN"

# 作品审核状态
curl -X POST http://localhost:3000/api/v1/admin-tools/sync-composition-status \
  -H "Authorization: Bearer $TOKEN"
```

### 查看日志
```bash
# 实时日志
docker logs -f zhihu-app-server-1 | grep sync

# 今日同步日志
docker logs zhihu-app-server-1 | grep "$(date +%Y-%m-%d)" | grep syncPlanStatus

# 错误日志
docker logs zhihu-app-server-1 | grep "失败\|Error" | tail -20
```

### 查询数据
```sql
-- 查看审核状态统计
SELECT 
  JSON_EXTRACT(zhihu_status_json, '$.auditStatus') as audit_status,
  COUNT(*) as count
FROM plans 
WHERE zhihu_status_json IS NOT NULL
GROUP BY audit_status;

-- 查看被拒绝的计划
SELECT 
  id, keyword,
  JSON_EXTRACT(zhihu_status_json, '$.rejectReason') as reject_reason
FROM plans 
WHERE JSON_EXTRACT(zhihu_status_json, '$.auditStatus') = 'rejected';

-- 查看最近更新的状态
SELECT 
  id, keyword, zhihu_status_json, updated_at
FROM plans 
WHERE zhihu_status_json IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;
```

## 📍 关键位置

### 前端入口
- 推广计划列表：`http://your-domain.com/admin/plans`
- 系统工具：`http://your-domain.com/admin/system/data`

### 后端代码
- 同步任务：`server/src/jobs/syncPlanStatus.ts`
- API 端点：`server/src/routes/admin-tools.ts`
- 定时调度：`server/src/jobs/index.ts`

### 数据库字段
- `plans.zhihu_status_json` - TEXT, JSON
- `compositions.zhihu_status_json` - TEXT, JSON

## 🕐 定时任务

- **执行时间**：每天凌晨 3:00（服务器时区）
- **执行顺序**：先同步推广计划，再同步作品
- **Cron 表达式**：`0 3 * * *`

## 🎨 状态标签

| 审核状态 | 标签颜色 | 含义 |
|---------|---------|------|
| `approved` | 绿色 | 审核通过 |
| `rejected` | 红色 | 审核拒绝 |
| `pending` / `auditing` | 灰色 | 待审核/审核中 |
| 空 | `—` | 未同步 |

## 🐛 快速诊断

### 问题：审核状态为空
```bash
# 1. 检查是否有已同步的计划
docker exec -i zhihu-app-server-1 mysql -uzhihu -p zhihu_koc \
  -e "SELECT COUNT(*) FROM plans WHERE zhihu_plan_id IS NOT NULL;"

# 2. 手动触发同步
curl -X POST http://localhost:3000/api/v1/admin-tools/sync-plan-status \
  -H "Authorization: Bearer $TOKEN"

# 3. 查看执行结果（等待 10 秒）
docker logs zhihu-app-server-1 | tail -20 | grep syncPlanStatus
```

### 问题：同步失败
```bash
# 1. 检查知乎 API 凭证
docker exec zhihu-app-server-1 env | grep ZHIHU

# 2. 测试知乎 API 连通性
curl -X GET "https://open.zhihu.com/alliance/api/popularize_plans?page=1&page_size=1" \
  -H "Authorization: Bearer $ZHIHU_TOKEN"

# 3. 查看完整错误
docker logs zhihu-app-server-1 | grep "syncPlanStatus 失败"
```

### 问题：定时任务未执行
```bash
# 1. 检查服务器时区
docker exec zhihu-app-server-1 date

# 2. 检查 cron 任务是否注册
docker logs zhihu-app-server-1 | grep "cron.schedule"

# 3. 查看今日是否执行过
docker logs zhihu-app-server-1 | grep "$(date +%Y-%m-%d)" | grep syncPlanStatus
```

## 📞 联系支持

- **功能文档**：`docs/FEATURE-ZHIHU-AUDIT-STATUS.md`
- **部署指南**：`docs/zhihu-audit-status-deployment.md`
- **验证清单**：`docs/VERIFICATION-CHECKLIST.md`

## 💡 使用技巧

### 批量检查审核状态
1. 创建多个推广计划
2. 等待 10-30 分钟（知乎审核时间）
3. 点击「系统工具」→「推广计划审核状态 - 立即同步」
4. 在推广计划列表查看批量审核结果

### 监控被拒绝的计划
```sql
-- 创建每日报告
SELECT 
  DATE(updated_at) as date,
  COUNT(*) as rejected_count,
  GROUP_CONCAT(keyword SEPARATOR ', ') as keywords
FROM plans 
WHERE JSON_EXTRACT(zhihu_status_json, '$.auditStatus') = 'rejected'
  AND DATE(updated_at) = CURDATE()
GROUP BY DATE(updated_at);
```

### 导出审核状态报告
```bash
docker exec -i zhihu-app-server-1 mysql -uzhihu -p zhihu_koc <<EOF > audit_report.csv
SELECT 
  id as '计划ID',
  keyword as '关键词',
  zhihu_plan_id as '知乎计划ID',
  JSON_EXTRACT(zhihu_status_json, '$.auditStatus') as '审核状态',
  JSON_EXTRACT(zhihu_status_json, '$.rejectReason') as '拒绝原因',
  DATE(updated_at) as '更新日期'
FROM plans 
WHERE zhihu_status_json IS NOT NULL
ORDER BY updated_at DESC;
EOF
```

---

**最后更新**：2025-01-XX  
**版本**：v1.0.0
