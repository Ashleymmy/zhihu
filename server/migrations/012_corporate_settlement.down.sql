ALTER TABLE withdrawal_requests
  DROP COLUMN IF EXISTS settle_type,
  DROP COLUMN IF EXISTS company_name,
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS bank_account,
  DROP COLUMN IF EXISTS tax_id,
  DROP COLUMN IF EXISTS invoice_path,
  DROP COLUMN IF EXISTS invoice_name,
  DROP COLUMN IF EXISTS invoice_uploaded_at;
