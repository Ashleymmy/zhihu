-- 云服务器收益链路诊断脚本
-- 使用方法：docker exec -i server-mysql-1 mysql -uzhihu -pzhihu_local_password zhihu_koc < debug-revenue-cloud.sql

SELECT '===== 1. 检查推广计划状态 =====' as step;
SELECT
  id, name, keyword, channel_id, owner_id,
  status, sync_status, sync_error,
  zhihu_plan_id, zhihu_task_id,
  DATE(created_at) as created_date
FROM plans
ORDER BY created_at DESC
LIMIT 5;

SELECT '\n===== 2. 检查达人账号配置 =====' as step;
SELECT
  u.id, u.username, u.role, u.parent_id,
  u.is_active, u.zhihu_uid,
  p.username as parent_name
FROM users u
LEFT JOIN users p ON u.parent_id = p.id
WHERE u.role IN ('creator', 'leader')
ORDER BY u.created_at DESC
LIMIT 5;

SELECT '\n===== 3. 检查知乎是否返回了数据（按同步时间统计）=====' as step;
SELECT
  DATE(fetched_at) as sync_date,
  COUNT(*) as records,
  SUM(impressions) as total_impressions,
  SUM(clicks) as total_clicks,
  SUM(conversions) as total_conversions,
  ROUND(SUM(earning), 2) as total_earning
FROM daily_metrics
GROUP BY DATE(fetched_at)
ORDER BY sync_date DESC
LIMIT 7;

SELECT '\n===== 4. 最近的 daily_metrics 明细 =====' as step;
SELECT
  id, stat_date, channel_id, keyword,
  impressions, clicks, conversions,
  ROUND(earning, 2) as earning,
  owner_id, plan_id,
  DATE_FORMAT(fetched_at, '%Y-%m-%d %H:%i') as fetched_time
FROM daily_metrics
ORDER BY fetched_at DESC, id DESC
LIMIT 10;

SELECT '\n===== 5. 检查定价规则是否生效 =====' as step;
SELECT
  id, target_role, method,
  ROUND(percentage * 100, 2) as percentage_pct,
  ROUND(unit_price, 2) as unit_price,
  status, priority
FROM pricing_rules
ORDER BY priority DESC, id;

SELECT '\n===== 6. 检查 earnings 表数据 =====' as step;
SELECT
  e.id, e.user_id, u.username, u.role,
  e.plan_id, e.settle_date,
  ROUND(e.amount, 2) as amount,
  e.status, e.source_ref,
  DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i') as created_time
FROM earnings e
LEFT JOIN users u ON e.user_id = u.id
ORDER BY e.created_at DESC
LIMIT 10;

SELECT '\n===== 7. 统计各环节数据量 =====' as step;
SELECT
  (SELECT COUNT(*) FROM plans WHERE status='active') as active_plans,
  (SELECT COUNT(*) FROM plans WHERE sync_status='synced') as synced_plans,
  (SELECT COUNT(*) FROM users WHERE role='creator' AND is_active=1) as active_creators,
  (SELECT COUNT(*) FROM daily_metrics WHERE earning > 0) as metrics_with_earning,
  (SELECT COUNT(*) FROM earnings) as earning_records,
  ROUND((SELECT SUM(earning) FROM daily_metrics), 2) as total_zhihu_earning,
  ROUND((SELECT SUM(amount) FROM earnings WHERE status='confirmed'), 2) as total_confirmed_earning;

SELECT '\n===== 8. 检查推广计划同步失败情况 =====' as step;
SELECT
  id, name, keyword, sync_status,
  sync_error,
  DATE(created_at) as created_date
FROM plans
WHERE sync_status = 'failed' OR sync_error IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;

SELECT '\n===== 9. 检查是否有收益但未结算的数据 =====' as step;
SELECT
  dm.stat_date,
  COUNT(*) as unsettle_count,
  ROUND(SUM(dm.earning), 2) as unsettle_amount
FROM daily_metrics dm
WHERE dm.earning > 0
  AND dm.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM earnings e
    WHERE e.plan_id = dm.plan_id
      AND e.user_id = dm.owner_id
      AND e.settle_date = dm.stat_date
      AND e.source_ref = CONCAT('metric:', dm.id)
  )
GROUP BY dm.stat_date
ORDER BY dm.stat_date DESC
LIMIT 7;

SELECT '\n===== 诊断提示 =====' as step;
SELECT '若推广计划 sync_status != synced：' as hint_1;
SELECT '→ 检查服务日志，看知乎 API 推送是否成功' as hint_2;
SELECT '→ 检查 .env 中知乎联盟 API 密钥配置' as hint_3;
SELECT '\n若 daily_metrics 无数据：' as hint_4;
SELECT '→ 知乎有 24-48h 延迟，等待后再查' as hint_5;
SELECT '→ 检查 syncMetrics 定时任务是否运行（查服务日志）' as hint_6;
SELECT '\n若 daily_metrics 有数据但 earnings 无：' as hint_7;
SELECT '→ 登录管理员后台，点击「手动结算」按钮' as hint_8;
SELECT '→ 检查服务日志看结算任务执行情况' as hint_9;
