-- 016: 完善导入批次的确认 / 驳回流程
-- 015 已创建暂存表；本迁移只补充导入工作流元数据和全局文件幂等约束。

ALTER TABLE data_import_batches
  DROP INDEX uk_data_import_creator_hash,
  ADD COLUMN rejected_by BIGINT NULL AFTER confirmed_at,
  ADD COLUMN rejected_at DATETIME NULL AFTER rejected_by,
  ADD COLUMN rejection_reason VARCHAR(500) NULL AFTER rejected_at,
  ADD UNIQUE KEY uk_data_import_hash (file_sha256),
  ADD CONSTRAINT fk_data_import_rejected FOREIGN KEY (rejected_by) REFERENCES users(id);
