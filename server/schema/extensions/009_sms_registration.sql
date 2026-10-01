ALTER TABLE users ADD COLUMN phone_verified_at DATETIME(3) NULL;

-- No plaintext phone numbers or verification codes are stored in these temporary tables.
CREATE TABLE IF NOT EXISTS sms_registration_challenges (
 phone_hash CHAR(64) PRIMARY KEY,
 challenge_id CHAR(32) NOT NULL,
 identity_hash CHAR(64) NOT NULL,
 code_hash CHAR(64) NOT NULL,
 state VARCHAR(16) NOT NULL,
 attempts INT NOT NULL DEFAULT 0,
 expires_at DATETIME(3) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX ix_sms_challenge_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sms_registration_limits (
 limit_key CHAR(64) NOT NULL,
 bucket BIGINT NOT NULL,
 count INT NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 PRIMARY KEY(limit_key,bucket),
 INDEX ix_sms_limit_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
