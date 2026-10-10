SET @offline_ddl=IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='opc_withdrawals' AND COLUMN_NAME='pay_method'),'SELECT 1','ALTER TABLE opc_withdrawals ADD pay_method VARCHAR(16) NOT NULL DEFAULT \'bank\', ADD pay_account VARCHAR(128) NULL, ADD payment_version INT NOT NULL DEFAULT 0');
PREPARE offline_stmt FROM @offline_ddl;
EXECUTE offline_stmt;
DEALLOCATE PREPARE offline_stmt;
ALTER TABLE opc_withdrawals MODIFY receiver_name VARCHAR(128) NULL, MODIFY bank_name VARCHAR(128) NULL, MODIFY bank_account VARCHAR(128) NULL;
CREATE TABLE IF NOT EXISTS opc_finance_requests (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,module_id VARCHAR(64) NOT NULL,project_id BIGINT NOT NULL,account_id BIGINT NOT NULL,
 actor_id BIGINT NOT NULL,operation VARCHAR(64) NOT NULL,request_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL,response_json JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_opc_finance_request(module_id,account_id,actor_id,operation,request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS opc_payment_changes (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,withdrawal_id BIGINT NOT NULL,actor_id BIGINT NOT NULL,
 action VARCHAR(16) NOT NULL,reason VARCHAR(500) NOT NULL,before_json JSON NOT NULL,after_json JSON NOT NULL,
 proof_name VARCHAR(255) NULL,proof_type VARCHAR(128) NULL,proof_bytes MEDIUMBLOB NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX ix_opc_payment_history(withdrawal_id,id),FOREIGN KEY(withdrawal_id) REFERENCES opc_withdrawals(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
