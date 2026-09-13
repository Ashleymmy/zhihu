CREATE TABLE zh_processing_jobs (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,account_id BIGINT NOT NULL,project_id BIGINT NOT NULL,batch_id BIGINT NOT NULL,
 actor_id BIGINT NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'pending',attempts INT NOT NULL DEFAULT 0,
 lease_token CHAR(36) NULL,lease_until DATETIME(3) NULL,next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 last_error VARCHAR(1000) NULL,updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_batch_job(batch_id),INDEX ix_zh_job_due(status,next_attempt_at,lease_until),
 FOREIGN KEY(batch_id) REFERENCES zh_import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
