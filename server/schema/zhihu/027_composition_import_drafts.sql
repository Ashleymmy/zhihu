CREATE TABLE IF NOT EXISTS composition_import_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  source_key CHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  sheet_name VARCHAR(128) NOT NULL,
  source_file MEDIUMBLOB NOT NULL,
  options_json JSON NOT NULL,
  preview_json JSON NOT NULL,
  total_count INT NOT NULL DEFAULT 0,
  pending_count INT NOT NULL DEFAULT 0,
  duplicate_count INT NOT NULL DEFAULT 0,
  ready_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_work_draft_source (owner_id, source_key),
  KEY idx_work_draft_owner (owner_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
