ALTER TABLE users ADD COLUMN admin_duty ENUM('all','operations','finance') NOT NULL DEFAULT 'all';
CREATE TABLE opc_income_sources (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,module_id VARCHAR(64) NOT NULL,project_id BIGINT NOT NULL,account_id BIGINT NOT NULL,
 source_key VARCHAR(128) NOT NULL,business_date DATE NOT NULL,source_version VARCHAR(128) NOT NULL,
 snapshot_hash CHAR(64) NOT NULL,blocked_reason VARCHAR(255) NULL,description VARCHAR(255) NOT NULL,
 UNIQUE KEY uk_opc_income_source(module_id,account_id,source_key),
 INDEX ix_opc_income_scope(project_id,account_id,business_date),
 FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(account_id) REFERENCES integration_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE opc_income_entries (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,source_id BIGINT NOT NULL,source_version VARCHAR(128) NOT NULL,user_id BIGINT NOT NULL,
 amount DECIMAL(20,4) NOT NULL,target_amount DECIMAL(20,4) NOT NULL,
 availability ENUM('held','available') NOT NULL DEFAULT 'held',entry_part ENUM('held','available') NOT NULL DEFAULT 'held',
 confirmed_by BIGINT NOT NULL,confirmed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 released_by BIGINT NULL,released_at DATETIME(3) NULL,release_reference VARCHAR(255) NULL,
 UNIQUE KEY uk_opc_income_version(source_id,source_version,user_id,entry_part),
 INDEX ix_opc_income_user(user_id,source_id),
 FOREIGN KEY(source_id) REFERENCES opc_income_sources(id),FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE opc_withdrawals (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,module_id VARCHAR(64) NOT NULL,project_id BIGINT NOT NULL,account_id BIGINT NOT NULL,user_id BIGINT NOT NULL,
 amount DECIMAL(20,4) NOT NULL,request_key VARCHAR(128) NOT NULL,request_hash CHAR(64) NOT NULL,
 status ENUM('pending','approved','paid','rejected','cancelled') NOT NULL DEFAULT 'pending',
 receiver_name VARCHAR(128) NOT NULL,bank_name VARCHAR(128) NOT NULL,bank_account VARCHAR(128) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),reviewed_by BIGINT NULL,reviewed_at DATETIME(3) NULL,remark VARCHAR(500) NULL,
 payment_reference VARCHAR(128) NULL,paid_on DATE NULL,paid_by BIGINT NULL,paid_at DATETIME(3) NULL,
 proof_name VARCHAR(255) NULL,proof_type VARCHAR(128) NULL,proof_bytes MEDIUMBLOB NULL,proof_hash CHAR(64) NULL,
 UNIQUE KEY uk_opc_withdraw_request(user_id,request_key),UNIQUE KEY uk_opc_payment_reference(payment_reference),
 INDEX ix_opc_withdraw_scope(project_id,account_id,user_id,status),
 FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(project_id) REFERENCES projects(id),FOREIGN KEY(account_id) REFERENCES integration_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


