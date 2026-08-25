-- 012: 对公结算、发票上传与结算单

ALTER TABLE withdrawal_requests
  ADD COLUMN settle_type ENUM('personal','corporate') NOT NULL DEFAULT 'personal' COMMENT 'personal=个人 settle corporate=对公' AFTER pay_account,
  ADD COLUMN company_name VARCHAR(128) NULL COMMENT '对公：公司名称' AFTER settle_type,
  ADD COLUMN bank_name VARCHAR(128) NULL COMMENT '对公：开户行' AFTER company_name,
  ADD COLUMN bank_account VARCHAR(64) NULL COMMENT '对公：银行账号' AFTER bank_name,
  ADD COLUMN tax_id VARCHAR(32) NULL COMMENT '对公：纳税人识别号' AFTER bank_account,
  ADD COLUMN invoice_path VARCHAR(255) NULL COMMENT '发票文件存储路径' AFTER tax_id,
  ADD COLUMN invoice_name VARCHAR(255) NULL COMMENT '发票原始文件名' AFTER invoice_path,
  ADD COLUMN invoice_uploaded_at DATETIME NULL COMMENT '发票上传时间' AFTER invoice_name;
