-- Additive: historical withdrawals retain their original amount and payment terms.
CREATE TABLE IF NOT EXISTS opc_withdrawal_terms (
 withdrawal_id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL,applied_day DATE NOT NULL,
 policy_version VARCHAR(64) NOT NULL,applicant_role VARCHAR(16) NOT NULL,
 fee_amount DECIMAL(20,4) NOT NULL,net_amount DECIMAL(20,4) NOT NULL,
 tier VARCHAR(16) NOT NULL,review_deadline DATE NOT NULL,settlement_deadline DATE NOT NULL,
 settlement_month CHAR(7) NULL,invoice_required TINYINT NOT NULL DEFAULT 0,
 terms_json JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_opc_withdrawal_day(user_id,applied_day),
 FOREIGN KEY(withdrawal_id) REFERENCES opc_withdrawals(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS opc_withdrawal_invoices (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,withdrawal_id BIGINT NOT NULL,version INT NOT NULL,
 uploaded_by BIGINT NOT NULL,filename VARCHAR(255) NOT NULL,mime_type VARCHAR(128) NOT NULL,
 content MEDIUMBLOB NOT NULL,content_hash CHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',reason VARCHAR(500) NULL,
 reviewed_by BIGINT NULL,reviewed_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_opc_withdrawal_invoice(withdrawal_id,version),
 FOREIGN KEY(withdrawal_id) REFERENCES opc_withdrawals(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS opc_withdrawal_invoice_instructions (
 withdrawal_id BIGINT PRIMARY KEY,instructions TEXT NOT NULL,updated_by BIGINT NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(withdrawal_id) REFERENCES opc_withdrawals(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
