-- 收益链路诊断脚本（在云服务器数据库执行）
-- 使用方法：mysql -u<user> -p<pass> <dbname> < debug-revenue.sql

SELECT '===== 1. 检查推广计划状态 =====' as step;
SELECT
  id, name, channel_id, owner_id, status, sync_status,
  zhihu_plan_id, zhihu_task_id, created_at
FROM plans
ORDER BY created_at DESC
LIMIT 5;

SELECT '\n===== 2. 检查达人账号配置 =====' as step;
SELECT
  id, username, role, parent_id,
  status, created_at
FROM users
WHERE role IN ('creator', 'leader')
ORDER BY created_at DESC
LIMIT 5;

SELECT '\n===== 3. 检查知乎是否返回了数据 =====' as step;
SELECT
  DATE(fetched_at) as sync_date,
  COUNT(*) as records,
  SUM(impressions) as total_impressions,
  SUM(clicks) as total_clicks,
  SUM(conversions) as total_conversions,
  SUM(earning) as total_earning
FROM daily_metrics
GROUP BY DATE(fetched_at)
ORDER BY sync_date DESC
LIMIT 7;

SELECT '\n===== 4. 最近的 daily_metrics 明细 =====' as step;
SELECT
  id, stat_date, channel_id, keyword,
  impressions, clicks, conversions, earning,
  owner_id, plan_id, fetched_at
FROM daily_metrics
ORDER BY fetched_at DESC, id DESC
LIMIT 10;

SELECT '\n===== 5. 检查定价规则是否生效 =====' as step;
SELECT
  id, target_role, method, percentage, unit_price, status
FROM pricing_rules
ORDER BY id;

SELECT '\n===== 6. 检查 earnings 表数据 =====' as step;
SELECT
  id, user_id, plan_id, settle_date,
  amount, status, source_ref, created_at
FROM earnings
ORDER BY created_at DESC
LIMIT 10;

SELECT '\n===== 7. 统计各环节数据量 =====' as step;
SELECT
  (SELECT COUNT(*) FROM plans WHERE status='active') as active_plans,
  (SELECT COUNT(*) FROM users WHERE role='creator') as creators,
  (SELECT COUNT(*) FROM daily_metrics WHERE earning > 0) as metrics_with_earning,
  (SELECT COUNT(*) FROM earnings) as earning_records,
  (SELECT SUM(earning) FROM daily_metrics) as total_zhihu_earning,
  (SELECT SUM(amount) FROM earnings WHERE status='confirmed') as total_confirmed_earning;

SELECT '\n===== 8. 检查知乎 API 配置 =====' as step;
-- 如果有配置表，检查知乎 API 相关配置
-- SELECT * FROM settings WHERE key LIKE '%zhihu%' OR key LIKE '%alliance%';

SELECT '\n===== 诊断完成 =====' as step;
SELECT '如果 daily_metrics 没有数据，检查：' as hint_1;
SELECT '1. 知乎联盟 API 密钥是否配置正确（.env 文件）' as hint_2;
SELECT '2. syncMetrics 定时任务是否正常运行（检查服务日志）' as hint_3;
SELECT '3. 推广计划的 callback_url 是否正确推送到知乎' as hint_4;
SELECT '\n如果 daily_metrics 有数据但 earnings 没有：' as hint_5;
SELECT '1. 点击「手动结算」按钮触发结算任务' as hint_6;
SELECT '2. 检查服务日志看结算任务是否执行成功' as hint_7;
