-- Clearing upload history preserves original reports, decisions and accounting sources.
CREATE TABLE IF NOT EXISTS zh_import_history_archive (
  batch_id BIGINT PRIMARY KEY,
  archived_by BIGINT NOT NULL,
  archived_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY(batch_id) REFERENCES zh_import_batches(id),
  FOREIGN KEY(archived_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
