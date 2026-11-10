CREATE TABLE IF NOT EXISTS opc_settlements (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 module_id VARCHAR(64) NOT NULL,project_id BIGINT NOT NULL,account_id BIGINT NOT NULL,leader_id BIGINT NOT NULL,
 business_from DATE NOT NULL,business_to DATE NOT NULL,metric_type VARCHAR(32) NULL,
 preview_version CHAR(64) NOT NULL,status ENUM('preview','confirmed') NOT NULL DEFAULT 'preview',
 document_json JSON NOT NULL,selection_json JSON NOT NULL,
 created_by BIGINT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 confirmed_by BIGINT NULL,confirmed_at DATETIME(3) NULL,
 KEY ix_opc_settlement_scope(module_id,project_id,account_id,leader_id,id),
 FOREIGN KEY(project_id) REFERENCES projects(id),FOREIGN KEY(account_id) REFERENCES integration_accounts(id),
 FOREIGN KEY(leader_id) REFERENCES users(id),FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS opc_settlement_requests (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,actor_id BIGINT NOT NULL,operation VARCHAR(32) NOT NULL,
 request_key VARCHAR(128) NOT NULL,request_hash CHAR(64) NOT NULL,response_json JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_opc_settlement_request(actor_id,operation,request_key),
 FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS opc_record_comments (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,module_id VARCHAR(64) NOT NULL,project_id BIGINT NOT NULL,account_id BIGINT NOT NULL,
 leader_id BIGINT NULL,context_kind ENUM('settlement','earning_source','evidence') NOT NULL,context_id BIGINT NOT NULL,
 channel_ref VARCHAR(128) NULL,business_date DATE NULL,metric_type VARCHAR(32) NULL,
 author_id BIGINT NOT NULL,body TEXT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_opc_comment_context(module_id,project_id,account_id,leader_id,context_kind,context_id,id),
 KEY ix_opc_comment_evidence(project_id,account_id,context_kind,context_id,channel_ref,business_date,metric_type,id),
 FOREIGN KEY(project_id) REFERENCES projects(id),FOREIGN KEY(account_id) REFERENCES integration_accounts(id),
 FOREIGN KEY(leader_id) REFERENCES users(id),FOREIGN KEY(author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
