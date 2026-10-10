CREATE TABLE IF NOT EXISTS zh_member_objections (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, account_id BIGINT NOT NULL, project_id BIGINT NOT NULL,
 fact_id BIGINT NOT NULL, payee_id BIGINT NOT NULL, raised_by BIGINT NOT NULL,
 detail VARCHAR(1000) NOT NULL, status ENUM('open','replied') NOT NULL DEFAULT 'open',
 open_payee BIGINT GENERATED ALWAYS AS (CASE WHEN status='open' THEN payee_id ELSE NULL END) STORED,
 reply VARCHAR(1000) NULL, replied_by BIGINT NULL, replied_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_objection_open(fact_id,open_payee),
 INDEX ix_zh_objection_scope(project_id,account_id,status,id),
 FOREIGN KEY(fact_id) REFERENCES zh_metric_facts(id), FOREIGN KEY(raised_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS zh_confirmation_jobs (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,account_id BIGINT NOT NULL,project_id BIGINT NOT NULL,
 actor_id BIGINT NOT NULL,period_json JSON NOT NULL,status ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
 total INT NOT NULL,waiting INT NOT NULL DEFAULT 0,confirmed INT NOT NULL DEFAULT 0,skipped INT NOT NULL DEFAULT 0,
 last_error VARCHAR(1000) NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 INDEX ix_zh_confirm_pending(status,id), FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS zh_confirmation_items (
 job_id BIGINT NOT NULL,fact_id BIGINT NOT NULL,review_token CHAR(64) NOT NULL,
 status ENUM('pending','confirmed','skipped') NOT NULL DEFAULT 'pending',reason VARCHAR(255) NULL,
 PRIMARY KEY(job_id,fact_id),INDEX ix_zh_confirm_items(job_id,status,fact_id),
 FOREIGN KEY(job_id) REFERENCES zh_confirmation_jobs(id),FOREIGN KEY(fact_id) REFERENCES zh_metric_facts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
