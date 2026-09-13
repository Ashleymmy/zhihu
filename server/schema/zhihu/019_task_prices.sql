CREATE TABLE zh_price_agreements (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, account_id BIGINT NOT NULL, project_id BIGINT NOT NULL,
 task_id BIGINT NOT NULL, payer_kind VARCHAR(16) NOT NULL, payer_id BIGINT NOT NULL,
 payee_id BIGINT NOT NULL, relation_type VARCHAR(32) NOT NULL,
 billing_metric VARCHAR(32) NOT NULL DEFAULT 'order_count', currency CHAR(3) NOT NULL DEFAULT 'CNY',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_price_scope(account_id,project_id,task_id,payer_kind,payer_id,payee_id),
 FOREIGN KEY(account_id) REFERENCES integration_accounts(id), FOREIGN KEY(project_id) REFERENCES projects(id),
 FOREIGN KEY(task_id) REFERENCES tasks(id), FOREIGN KEY(payee_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE zh_price_versions (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, agreement_id BIGINT NOT NULL, unit_price DECIMAL(20,4) NOT NULL,
 effective_from DATE NOT NULL, effective_to DATE NULL, status VARCHAR(16) NOT NULL DEFAULT 'draft',
 created_by BIGINT NOT NULL, published_by BIGINT NULL, published_at DATETIME(3) NULL,
 reason VARCHAR(500) NOT NULL, relationship_snapshot JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX ix_zh_price_date(agreement_id,status,effective_from),
 FOREIGN KEY(agreement_id) REFERENCES zh_price_agreements(id),
 CHECK(unit_price>=0), CHECK(effective_to IS NULL OR effective_to>effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
