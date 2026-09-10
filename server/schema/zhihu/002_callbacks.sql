CREATE TABLE IF NOT EXISTS callback_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  plan_id BIGINT NULL,
  owner_id BIGINT NOT NULL,
  callback_url VARCHAR(1024) NOT NULL,
  events_json JSON NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_callback_rules_owner (owner_id),
  INDEX idx_callback_rules_plan (plan_id),
  CONSTRAINT fk_callback_rules_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_callback_rules_plan FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS callback_secrets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL UNIQUE,
  secret_ciphertext TEXT NOT NULL,
  secret_iv VARCHAR(32) NOT NULL,
  secret_auth_tag VARCHAR(32) NOT NULL,
  last_four CHAR(4) NOT NULL,
  rotated_by BIGINT NOT NULL,
  rotated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS callback_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  rule_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  event VARCHAR(64) NOT NULL,
  keyword VARCHAR(128) NULL,
  status ENUM('success','failed','retry') NOT NULL,
  response_code INT NULL,
  latency_ms INT NULL,
  error_message VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_callback_logs_owner_time (owner_id, created_at),
  INDEX idx_callback_logs_rule_time (rule_id, created_at),
  CONSTRAINT fk_callback_logs_rule FOREIGN KEY (rule_id) REFERENCES callback_rules(id),
  CONSTRAINT fk_callback_logs_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
