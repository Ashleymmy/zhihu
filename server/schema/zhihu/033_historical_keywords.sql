-- Registered history is never a pending create request and has no fake receipt.
ALTER TABLE plans MODIFY sync_status ENUM('local','syncing','synced','failed','simulated','historical') NOT NULL DEFAULT 'local';
