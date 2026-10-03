ALTER TABLE users
 ADD COLUMN closed_at DATETIME(3) NULL,
 ADD CONSTRAINT chk_closed_account_inactive CHECK (closed_at IS NULL OR is_active=0);
