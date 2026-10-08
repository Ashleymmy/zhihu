CREATE TABLE IF NOT EXISTS opc_analysis_answers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  module_id VARCHAR(32) NOT NULL,
  run_key VARCHAR(128) NOT NULL,
  ask_key VARCHAR(160) NOT NULL,
  option_key VARCHAR(160) NOT NULL,
  answered_by BIGINT NOT NULL,
  answered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_analysis_answer(project_id,account_id,module_id,run_key,ask_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
