CREATE TABLE member_change_runs (
  id CHAR(36) PRIMARY KEY,
  actor_id BIGINT NOT NULL,
  operation_json JSON NOT NULL,
  review_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'preview',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_member_changes_actor(actor_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE member_change_items (
  run_id CHAR(36) NOT NULL,
  ordinal INT NOT NULL,
  reference VARCHAR(64) NOT NULL,
  user_id BIGINT NULL,
  status VARCHAR(16) NOT NULL,
  message VARCHAR(1000) NOT NULL DEFAULT '',
  preview_json JSON NULL,
  PRIMARY KEY(run_id,ordinal),
  CONSTRAINT fk_member_change_run FOREIGN KEY(run_id) REFERENCES member_change_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
