-- Keep the original report for audit while allowing the same file to be uploaded again.
SET @has_upload_generation=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='zh_import_batches' AND COLUMN_NAME='upload_generation');
SET @withdraw_ddl=IF(@has_upload_generation=0,'ALTER TABLE zh_import_batches ADD upload_generation INT NOT NULL DEFAULT 0','SELECT 1');
PREPARE withdraw_stmt FROM @withdraw_ddl;
EXECUTE withdraw_stmt;
DEALLOCATE PREPARE withdraw_stmt;
SET @upload_key=(SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='zh_import_batches' AND INDEX_NAME='uk_zh_file');
SET @withdraw_ddl=IF(@upload_key='account_id,file_sha256,report_kind,template_version,upload_generation','SELECT 1','ALTER TABLE zh_import_batches DROP INDEX uk_zh_file, ADD UNIQUE KEY uk_zh_file(account_id,file_sha256,report_kind,template_version,upload_generation)');
PREPARE withdraw_stmt FROM @withdraw_ddl;
EXECUTE withdraw_stmt;
DEALLOCATE PREPARE withdraw_stmt;
