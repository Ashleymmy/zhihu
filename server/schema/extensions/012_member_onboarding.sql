-- Backfill missing initial access; do not restore explicitly removed memberships.
INSERT INTO project_members(project_id,user_id,member_role)
SELECT p.id,u.id,'member'
FROM projects p CROSS JOIN users u
LEFT JOIN project_members old ON old.project_id=p.id AND old.user_id=u.id
WHERE p.slug='zhihu' AND p.is_enabled=1
  AND u.role IN ('leader','creator') AND u.is_active=1 AND old.id IS NULL;

INSERT INTO project_members(project_id,user_id,member_role)
SELECT pm.project_id,u.id,'member'
FROM users u JOIN users leader ON leader.id=u.parent_id AND leader.role='leader' AND leader.is_active=1
JOIN project_members pm ON pm.user_id=leader.id AND pm.left_at IS NULL
JOIN projects p ON p.id=pm.project_id AND p.is_enabled=1
LEFT JOIN project_members old ON old.project_id=pm.project_id AND old.user_id=u.id
WHERE u.role='creator' AND u.is_active=1 AND old.id IS NULL;
