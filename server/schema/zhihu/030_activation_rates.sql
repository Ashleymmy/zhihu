INSERT INTO opc_rate_rules(project_id,module_id,metric_type,rule_code,unit_price,effective_from,status,published_at,reason)
SELECT DISTINCT pi.project_id,'zhihu','activation',seed.rule_code,seed.price,'2026-01-01','published',NOW(3),'拉活初始角色单价'
FROM project_integrations pi JOIN integration_accounts a ON a.id=pi.account_id AND a.module_id='zhihu'
CROSS JOIN (
  SELECT 'leader_self' rule_code,1.6000 price UNION ALL
  SELECT 'creator',1.2000 UNION ALL
  SELECT 'leader_override',0.4000 UNION ALL
  SELECT 'staff_self',2.0000 UNION ALL
  SELECT 'upstream',2.0000
) seed
WHERE NOT EXISTS(SELECT 1 FROM opc_rate_rules r WHERE r.project_id=pi.project_id AND r.module_id='zhihu'
  AND r.metric_type='activation' AND r.rule_code=seed.rule_code);
