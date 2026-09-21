/** Resolve historical plans only when their account is unambiguous. No ownership is rewritten. */
export function planAccountSql(alias = 'p'): string {
  if (!/^[a-z]+$/i.test(alias)) throw new Error('Invalid plan alias');
  const accounts = `FROM integration_accounts ia JOIN project_integrations pi ON pi.account_id=ia.id
    WHERE pi.project_id=${alias}.project_id AND ia.module_id='zhihu' AND ia.status='active'`;
  const mapped = `${accounts} AND EXISTS (
    SELECT 1 FROM zh_channel_mappings cm JOIN channels ch ON ch.id=cm.channel_id
    WHERE cm.account_id=ia.id AND cm.project_id=${alias}.project_id AND ch.project_id=${alias}.project_id
      AND ch.zhihu_channel_id=${alias}.channel_id AND cm.canonical_id IS NULL)`;
  return `COALESCE((SELECT kw.account_id FROM zh_keywords kw WHERE kw.plan_id=${alias}.id),
    CASE WHEN (SELECT COUNT(*) ${mapped})=1 THEN (SELECT MIN(ia.id) ${mapped})
      WHEN (SELECT COUNT(*) ${mapped})=0 AND (SELECT COUNT(*) ${accounts})=1
      THEN (SELECT MIN(ia.id) ${accounts}) ELSE NULL END)`;
}
