ALTER TABLE zh_metric_facts ADD current_result_id BIGINT NULL,
 ADD CONSTRAINT fk_zh_current_result FOREIGN KEY(current_result_id) REFERENCES zh_attribution_results(id);
UPDATE zh_metric_facts f SET current_result_id=(SELECT MAX(r.id) FROM zh_attribution_results r WHERE r.fact_id=f.id AND r.revision_id=f.current_revision_id);
CREATE TABLE zh_evidence (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,binding_id BIGINT NOT NULL,
 work_url VARCHAR(2048) NOT NULL,description VARCHAR(1000) NOT NULL,submitted_by BIGINT NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',reviewed_by BIGINT NULL,reason VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),reviewed_at DATETIME(3) NULL,
 FOREIGN KEY(binding_id) REFERENCES zh_keyword_bindings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE zh_statement_entries (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,account_id BIGINT NOT NULL,project_id BIGINT NOT NULL,
 fact_id BIGINT NOT NULL,result_id BIGINT NOT NULL,revision_id BIGINT NOT NULL,binding_id BIGINT NOT NULL,
 relation_type VARCHAR(32) NOT NULL,payer_kind VARCHAR(16) NOT NULL,payer_id BIGINT NOT NULL,payee_id BIGINT NOT NULL,
 entry_kind VARCHAR(16) NOT NULL,amount DECIMAL(20,4) NOT NULL,target_amount DECIMAL(20,4) NOT NULL,
 previous_entry_id BIGINT NULL,snapshot_json JSON NOT NULL,input_hash CHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'draft',confirmed_by BIGINT NULL,confirmed_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_statement_input(fact_id,relation_type,input_hash),
 INDEX ix_zh_statement_scope(account_id,project_id,payer_kind,payer_id,status),
 FOREIGN KEY(fact_id) REFERENCES zh_metric_facts(id),FOREIGN KEY(result_id) REFERENCES zh_attribution_results(id),
 FOREIGN KEY(revision_id) REFERENCES zh_metric_revisions(id),FOREIGN KEY(binding_id) REFERENCES zh_keyword_bindings(id),
 FOREIGN KEY(previous_entry_id) REFERENCES zh_statement_entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
