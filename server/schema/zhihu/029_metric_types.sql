-- Keep old inserts compatible. A rerun after an interrupted DDL is safe.
SET @metric_column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='zh_metric_facts' AND COLUMN_NAME='metric_type');
SET @metric_ddl = IF(@metric_column_exists=0, 'ALTER TABLE zh_metric_facts ADD COLUMN metric_type VARCHAR(16) NOT NULL DEFAULT ''new_user''', 'SELECT 1');
PREPARE metric_stmt FROM @metric_ddl;
EXECUTE metric_stmt;
DEALLOCATE PREPARE metric_stmt;

SET @fact_index_columns = (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='zh_metric_facts' AND INDEX_NAME='uk_zh_fact');
-- Replace the key in one atomic ALTER so concurrent legacy writes never see a
-- table without its business uniqueness constraint.
SET @metric_ddl = IF(@fact_index_columns IS NULL, 'ALTER TABLE zh_metric_facts ADD UNIQUE KEY uk_zh_fact(account_id,channel_mapping_id,keyword_id,business_date,metric_type)', IF(@fact_index_columns<>'account_id,channel_mapping_id,keyword_id,business_date,metric_type', 'ALTER TABLE zh_metric_facts DROP INDEX uk_zh_fact, ADD UNIQUE KEY uk_zh_fact(account_id,channel_mapping_id,keyword_id,business_date,metric_type)', 'SELECT 1'));
PREPARE metric_stmt FROM @metric_ddl;
EXECUTE metric_stmt;
DEALLOCATE PREPARE metric_stmt;
