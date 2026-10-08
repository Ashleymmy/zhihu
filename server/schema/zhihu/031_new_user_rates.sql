INSERT INTO opc_rate_rules(project_id,module_id,metric_type,rule_code,unit_price,effective_from,status,published_at,reason)
SELECT DISTINCT pi.project_id,'zhihu','new_user',seed.rule_code,seed.price,'2026-01-01','published',NOW(3),'拉新初始角色单价'
FROM project_integrations pi JOIN integration_accounts a ON a.id=pi.account_id AND a.module_id='zhihu'
CROSS JOIN (
  SELECT 'staff_self' rule_code,10.0000 price UNION ALL
  SELECT 'leader_self',8.5000 UNION ALL
  SELECT 'creator',8.0000 UNION ALL
  SELECT 'leader_override',0.5000
) seed
WHERE NOT EXISTS(SELECT 1 FROM opc_rate_rules r WHERE r.project_id=pi.project_id AND r.module_id='zhihu'
  AND r.metric_type='new_user' AND r.rule_code=seed.rule_code);
