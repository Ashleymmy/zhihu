-- Replace the original anonymous path check atomically; interrupted/repeated
-- migration never leaves the table without a valid ownership constraint.
SET @staff_path_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='zh_keyword_bindings' AND CONSTRAINT_NAME='ck_zh_binding_path');
SET @staff_old_checks = (SELECT GROUP_CONCAT(CONCAT('DROP CHECK `',REPLACE(tc.CONSTRAINT_NAME,'`','``'),'`') SEPARATOR ', ') FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='zh_keyword_bindings' AND tc.CONSTRAINT_TYPE='CHECK' AND cc.CHECK_CLAUSE LIKE '%path_type%');
SET @staff_path_ddl = IF(@staff_path_exists>0,'SELECT 1',CONCAT('ALTER TABLE zh_keyword_bindings ',IF(@staff_old_checks IS NULL,'',CONCAT(@staff_old_checks,', ')), 'ADD CONSTRAINT ck_zh_binding_path CHECK ((path_type=''reserved'' AND leader_id IS NOT NULL AND executor_id IS NULL) OR (path_type=''team_creator'' AND leader_id IS NOT NULL AND executor_id IS NOT NULL AND leader_id<>executor_id) OR (path_type IN (''direct_creator'',''staff_self'') AND leader_id IS NULL AND executor_id IS NOT NULL) OR (path_type=''leader_self'' AND leader_id IS NOT NULL AND executor_id IS NOT NULL AND leader_id=executor_id))'));
PREPARE staff_path_statement FROM @staff_path_ddl;
EXECUTE staff_path_statement;
DEALLOCATE PREPARE staff_path_statement;
