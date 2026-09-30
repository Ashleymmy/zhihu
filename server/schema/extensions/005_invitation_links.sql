ALTER TABLE member_invitations
 ADD COLUMN token_cipher TEXT NULL,
 ADD COLUMN deleted_at DATETIME(3) NULL;
