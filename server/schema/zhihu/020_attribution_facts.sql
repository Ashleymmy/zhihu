CREATE TABLE zh_import_batches (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, account_id BIGINT NOT NULL, project_id BIGINT NOT NULL,
 file_name VARCHAR(255) NOT NULL, file_sha256 CHAR(64) NOT NULL, file_bytes MEDIUMBLOB NOT NULL,
 report_kind VARCHAR(16) NOT NULL, template_version VARCHAR(32) NOT NULL,
 preview_hash CHAR(64) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'preview',
 created_by BIGINT NOT NULL, committed_by BIGINT NULL, committed_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_file(account_id,file_sha256,report_kind,template_version),
 FOREIGN KEY(account_id) REFERENCES integration_accounts(id), FOREIGN KEY(project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE zh_import_rows (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,batch_id BIGINT NOT NULL,line_number INT NOT NULL,
 normalized_json JSON NOT NULL,raw_json JSON NOT NULL,error_text VARCHAR(1000) NULL,
 processing_status VARCHAR(16) NOT NULL DEFAULT 'pending',fact_id BIGINT NULL,
 UNIQUE KEY uk_zh_source_row(batch_id,line_number), INDEX ix_zh_process(batch_id,processing_status,id),
 FOREIGN KEY(batch_id) REFERENCES zh_import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE zh_metric_facts (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,account_id BIGINT NOT NULL,project_id BIGINT NOT NULL,
 channel_mapping_id BIGINT NOT NULL,keyword_id BIGINT NOT NULL,business_date DATE NOT NULL,
 current_revision_id BIGINT NULL,version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_fact(account_id,channel_mapping_id,keyword_id,business_date),
 FOREIGN KEY(keyword_id) REFERENCES zh_keywords(id), FOREIGN KEY(channel_mapping_id) REFERENCES zh_channel_mappings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE zh_metric_revisions (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,fact_id BIGINT NOT NULL,source_row_id BIGINT NOT NULL,
 parent_revision_id BIGINT NULL,snapshot_json JSON NOT NULL,status VARCHAR(16) NOT NULL,
 accepted_by BIGINT NULL,reason VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_revision_source(fact_id,source_row_id),
 FOREIGN KEY(fact_id) REFERENCES zh_metric_facts(id),FOREIGN KEY(source_row_id) REFERENCES zh_import_rows(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE zh_metric_facts ADD CONSTRAINT fk_zh_current_revision FOREIGN KEY(current_revision_id) REFERENCES zh_metric_revisions(id);
CREATE TABLE zh_attribution_results (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,fact_id BIGINT NOT NULL,revision_id BIGINT NOT NULL,binding_id BIGINT NULL,
 input_hash CHAR(64) NOT NULL,algorithm_version VARCHAR(16) NOT NULL DEFAULT 'exclusive-v1',
 status VARCHAR(32) NOT NULL,reason_code VARCHAR(64) NULL,snapshot_json JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_result(fact_id,input_hash),
 FOREIGN KEY(fact_id) REFERENCES zh_metric_facts(id),FOREIGN KEY(revision_id) REFERENCES zh_metric_revisions(id),
 FOREIGN KEY(binding_id) REFERENCES zh_keyword_bindings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE zh_exceptions (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,account_id BIGINT NOT NULL,project_id BIGINT NOT NULL,
 source_row_id BIGINT NULL,fact_id BIGINT NULL,reason_code VARCHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'open',resolution VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),resolved_at DATETIME(3) NULL,
 INDEX ix_zh_exception_scope(account_id,project_id,status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
