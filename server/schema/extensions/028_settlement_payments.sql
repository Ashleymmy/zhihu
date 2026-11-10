CREATE TABLE IF NOT EXISTS opc_settlement_payment_origins (
 withdrawal_id BIGINT PRIMARY KEY,settlement_id BIGINT NOT NULL,initiated_by BIGINT NOT NULL,
 failure_reason VARCHAR(500) NULL,attempt_version INT NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(withdrawal_id) REFERENCES opc_withdrawals(id),
 FOREIGN KEY(settlement_id) REFERENCES opc_settlements(id),FOREIGN KEY(initiated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS opc_settlement_payment_allocations (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,withdrawal_id BIGINT NOT NULL,settlement_id BIGINT NOT NULL,
 income_source_id BIGINT NOT NULL,earning_source_id BIGINT NOT NULL,user_id BIGINT NOT NULL,
 amount DECIMAL(20,4) NOT NULL,source_version VARCHAR(128) NOT NULL,entry_ids_json JSON NOT NULL,
 linked_by BIGINT NOT NULL,linked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_opc_payment_allocation(withdrawal_id,income_source_id),
 KEY ix_opc_payment_source(income_source_id,user_id),KEY ix_opc_payment_settlement(settlement_id,withdrawal_id),
 FOREIGN KEY(withdrawal_id) REFERENCES opc_withdrawals(id),FOREIGN KEY(settlement_id) REFERENCES opc_settlements(id),
 FOREIGN KEY(income_source_id) REFERENCES opc_income_sources(id),FOREIGN KEY(earning_source_id) REFERENCES opc_earning_sources(id),
 FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(linked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS opc_settlement_payment_events (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,withdrawal_id BIGINT NOT NULL,settlement_id BIGINT NOT NULL,
 actor_id BIGINT NOT NULL,event_type VARCHAR(32) NOT NULL,reason VARCHAR(500) NOT NULL,
 before_json JSON NOT NULL,after_json JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_opc_payment_event(withdrawal_id,id),
 FOREIGN KEY(withdrawal_id) REFERENCES opc_withdrawals(id),FOREIGN KEY(settlement_id) REFERENCES opc_settlements(id),
 FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE opc_record_comments MODIFY COLUMN context_kind ENUM('settlement','earning_source','evidence','withdrawal') NOT NULL;
