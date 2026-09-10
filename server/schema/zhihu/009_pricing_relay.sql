-- 009: 定价规则 + 结算批次 + 中继计算日志
-- 资金链路：Admin 手工登记结算批次（归属到达人）→ 审批时按定价规则计算 → 写入 earnings(confirmed) → 提现消费

CREATE TABLE IF NOT EXISTS pricing_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  target_user_id BIGINT NULL COMMENT '指定账号；为空表示角色默认规则',
  target_role ENUM('leader','creator') NOT NULL,
  method ENUM('fixed','percentage') NOT NULL COMMENT 'fixed=每条来源记录固定金额；percentage=按来源金额比例',
  unit_price DECIMAL(18,4) NULL COMMENT 'fixed 时的金额（元）',
  percentage DECIMAL(9,6) NULL COMMENT '0 到 1，percentage 时的比例',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  priority INT NOT NULL DEFAULT 0 COMMENT '命中优先级，越大越优先；指定账号规则恒优先于角色默认',
  effective_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT ck_pricing_rules_value CHECK (
    (method = 'fixed' AND unit_price IS NOT NULL AND unit_price >= 0 AND percentage IS NULL) OR
    (method = 'percentage' AND unit_price IS NULL AND percentage IS NOT NULL AND percentage BETWEEN 0 AND 1)
  ),
  CONSTRAINT fk_pricing_rules_user FOREIGN KEY (target_user_id) REFERENCES users(id),
  CONSTRAINT fk_pricing_rules_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_pricing_rules_match (target_role, status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Admin 对下游账号的定价规则';

CREATE TABLE IF NOT EXISTS settlement_batches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(128) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status ENUM('draft','approved','cancelled') NOT NULL DEFAULT 'draft',
  total_source DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '来源总金额（元）',
  total_relay DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '中继分发总金额（元）',
  created_by BIGINT NOT NULL,
  approved_by BIGINT NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_settlement_period CHECK (period_start <= period_end),
  CONSTRAINT fk_settlement_created FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_settlement_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='结算批次（手工登记入口，后续可替换为 XLSX 适配器）';

CREATE TABLE IF NOT EXISTS settlement_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_id BIGINT NOT NULL,
  creator_id BIGINT NOT NULL COMMENT '来源金额归属的达人',
  source_amount DECIMAL(18,4) NOT NULL COMMENT '该达人产出的上游结算金额（元）',
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_settlement_item (batch_id, creator_id),
  CONSTRAINT fk_settlement_item_batch FOREIGN KEY (batch_id) REFERENCES settlement_batches(id),
  CONSTRAINT fk_settlement_item_creator FOREIGN KEY (creator_id) REFERENCES users(id),
  CONSTRAINT ck_settlement_item_amount CHECK (source_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='结算批次明细（按达人归属）';

CREATE TABLE IF NOT EXISTS relay_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  earning_id BIGINT NULL COMMENT '写入的 earnings 行',
  user_id BIGINT NOT NULL COMMENT '收益接收方',
  role ENUM('leader','creator') NOT NULL,
  rule_id BIGINT NULL COMMENT '命中的定价规则；NULL 表示无规则全额直通',
  method VARCHAR(16) NOT NULL COMMENT 'fixed/percentage/passthrough',
  unit_price DECIMAL(18,4) NULL,
  percentage DECIMAL(9,6) NULL,
  source_amount DECIMAL(18,4) NOT NULL,
  relay_amount DECIMAL(18,4) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_relay_logs_batch FOREIGN KEY (batch_id) REFERENCES settlement_batches(id),
  CONSTRAINT fk_relay_logs_earning FOREIGN KEY (earning_id) REFERENCES earnings(id),
  INDEX idx_relay_logs_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='中继计算快照日志（不可变）';
