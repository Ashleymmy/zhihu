CREATE TABLE IF NOT EXISTS zh_risk_images (
  id CHAR(36) PRIMARY KEY,
  project_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  actor_id BIGINT NOT NULL,
  file_hash CHAR(64) NOT NULL,
  file_token VARCHAR(512) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_risk_image_owner (account_id,project_id,actor_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS zh_risk_reports (
  id CHAR(36) PRIMARY KEY,
  project_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  actor_id BIGINT NOT NULL,
  request_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  composition_id BIGINT NOT NULL,
  upstream_composition_id VARCHAR(32) NOT NULL,
  keyword VARCHAR(128) NOT NULL,
  risk_type TINYINT NOT NULL,
  payload_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  message VARCHAR(500) NOT NULL DEFAULT '',
  attempt INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_risk_request (account_id,actor_id,request_key),
  UNIQUE KEY uk_risk_content (account_id,project_id,content_hash),
  KEY idx_risk_report_scope (account_id,project_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
