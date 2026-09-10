-- 015: 邮件附件 / Excel 数据导入暂存
-- 先完成上传、解析、校验和人工确认；本迁移不写入收益、归因或结算业务表。

CREATE TABLE IF NOT EXISTS data_import_batches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  source_type ENUM('email_attachment','manual_excel') NOT NULL DEFAULT 'email_attachment',
  file_name VARCHAR(255) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  file_sha256 CHAR(64) NOT NULL,
  sheet_name VARCHAR(128) NOT NULL,
  report_type ENUM('search','order','unknown') NOT NULL DEFAULT 'unknown',
  status ENUM('preview','confirmed','rejected') NOT NULL DEFAULT 'preview',
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  valid_rows INT UNSIGNED NOT NULL DEFAULT 0,
  error_rows INT UNSIGNED NOT NULL DEFAULT 0,
  errors_json JSON NOT NULL,
  headers_json JSON NOT NULL,
  created_by BIGINT NOT NULL,
  confirmed_by BIGINT NULL,
  confirmed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_data_import_created FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_data_import_confirmed FOREIGN KEY (confirmed_by) REFERENCES users(id),
  INDEX idx_data_import_created (created_by, created_at),
  INDEX idx_data_import_status (status, created_at),
  INDEX idx_data_import_hash (file_sha256),
  UNIQUE KEY uk_data_import_creator_hash (created_by, file_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮件附件与 Excel 导入批次';

CREATE TABLE IF NOT EXISTS data_import_rows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_id BIGINT NOT NULL,
  `row_number` INT UNSIGNED NOT NULL,
  occurred_at DATETIME NULL,
  channel_name VARCHAR(255) NULL,
  keyword VARCHAR(255) NULL,
  promotion_task VARCHAR(255) NULL,
  risk_decision VARCHAR(128) NULL,
  search_volume DECIMAL(18,4) NULL,
  order_count DECIMAL(18,4) NULL,
  search_conversion_rate DECIMAL(9,6) NULL,
  revenue_amount DECIMAL(18,4) NULL,
  validation_status ENUM('valid','invalid') NOT NULL,
  errors_json JSON NOT NULL,
  raw_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_data_import_row (batch_id, `row_number`),
  CONSTRAINT fk_data_import_row_batch FOREIGN KEY (batch_id) REFERENCES data_import_batches(id),
  INDEX idx_data_import_row_status (batch_id, validation_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='导入文件标准化行与原始值';
