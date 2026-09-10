-- 回滚 016: 恢复按操作人隔离的文件幂等约束，并移除驳回元数据。

ALTER TABLE data_import_batches
  DROP FOREIGN KEY fk_data_import_rejected,
  DROP INDEX uk_data_import_hash,
  DROP COLUMN rejection_reason,
  DROP COLUMN rejected_at,
  DROP COLUMN rejected_by,
  ADD UNIQUE KEY uk_data_import_creator_hash (created_by, file_sha256);
