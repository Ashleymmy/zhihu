CREATE TABLE IF NOT EXISTS opc_earning_sources (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 module_id VARCHAR(64) NOT NULL,project_id BIGINT NOT NULL,account_id BIGINT NOT NULL,
 source_key VARCHAR(128) NOT NULL,current_version VARCHAR(128) NOT NULL,
 business_date DATE NOT NULL,task_id VARCHAR(128) NOT NULL,task_name VARCHAR(255) NOT NULL,
 metric_type VARCHAR(32) NOT NULL,metric_label VARCHAR(64) NOT NULL,quantity_unit VARCHAR(16) NOT NULL,
 blocked_reason VARCHAR(255) NULL,
 UNIQUE KEY uk_opc_earning_source(module_id,account_id,source_key),
 KEY ix_opc_earning_scope(project_id,account_id,business_date),
 FOREIGN KEY(project_id) REFERENCES projects(id),FOREIGN KEY(account_id) REFERENCES integration_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS opc_earning_lines (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,source_id BIGINT NOT NULL,source_version VARCHAR(128) NOT NULL,
 payee_id BIGINT NOT NULL,performer_id BIGINT NULL,performer_name VARCHAR(128) NOT NULL,
 rule_code VARCHAR(64) NOT NULL,quantity DECIMAL(20,0) NULL,unit_price DECIMAL(20,4) NULL,amount DECIMAL(20,4) NULL,
 is_internal TINYINT(1) NOT NULL DEFAULT 0,is_ready TINYINT(1) NOT NULL DEFAULT 0,
 blocked_reason VARCHAR(255) NOT NULL DEFAULT '',next_action VARCHAR(255) NOT NULL DEFAULT '',
 confirmed_at DATETIME(3) NULL,confirmed_by BIGINT NULL,delta_amount DECIMAL(20,4) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_opc_earning_line(source_id,source_version,payee_id),
 KEY ix_opc_earning_payee(payee_id,source_id),
 FOREIGN KEY(source_id) REFERENCES opc_earning_sources(id),FOREIGN KEY(payee_id) REFERENCES users(id),
 CHECK(amount IS NULL OR amount>=0),CHECK(unit_price IS NULL OR unit_price>=0),CHECK(quantity IS NULL OR quantity>=0),
 CHECK(is_internal=0 OR confirmed_at IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
