DROP TABLE IF EXISTS finance_appeals;
ALTER TABLE withdrawal_requests
  MODIFY COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  DROP COLUMN IF EXISTS leader_id,
  DROP COLUMN IF EXISTS leader_handled_at,
  DROP COLUMN IF EXISTS leader_remark,
  DROP COLUMN IF EXISTS risk_flags;
