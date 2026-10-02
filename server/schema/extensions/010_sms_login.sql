ALTER TABLE sms_registration_challenges
 ADD COLUMN purpose VARCHAR(24) NOT NULL DEFAULT 'registration',
 ADD COLUMN subject_hash CHAR(64) NULL;

-- Legacy contact numbers remain unverified; only verified numbers must be unique.
ALTER TABLE users
 ADD COLUMN verified_phone_key VARCHAR(64) GENERATED ALWAYS AS
   (CASE WHEN phone_verified_at IS NOT NULL THEN phone ELSE NULL END) STORED,
 ADD UNIQUE KEY uq_users_verified_phone(verified_phone_key);
