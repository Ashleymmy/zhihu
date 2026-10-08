CREATE TABLE IF NOT EXISTS zh_risk_reviews (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 fact_id BIGINT NOT NULL,
 revision_id BIGINT NOT NULL,
 decision ENUM('accepted','excluded') NOT NULL,
 reason VARCHAR(500) NOT NULL,
 reviewed_by BIGINT NOT NULL,
 reviewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_risk_revision(fact_id,revision_id),
 CONSTRAINT fk_zh_risk_fact FOREIGN KEY(fact_id) REFERENCES zh_metric_facts(id),
 CONSTRAINT fk_zh_risk_revision FOREIGN KEY(revision_id) REFERENCES zh_metric_revisions(id),
 CONSTRAINT fk_zh_risk_reviewer FOREIGN KEY(reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
