CREATE TABLE IF NOT EXISTS opc_rate_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  module_id VARCHAR(32) NOT NULL,
  metric_type VARCHAR(16) NOT NULL,
  rule_code VARCHAR(32) NOT NULL,
  unit_price DECIMAL(18,4) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'published',
  created_by BIGINT NULL,
  published_by BIGINT NULL,
  published_at DATETIME(3) NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_opc_rate_lookup (project_id,module_id,metric_type,rule_code,effective_from),
  CHECK (unit_price >= 0),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
