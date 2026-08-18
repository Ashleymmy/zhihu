-- 004_identity_rbac.down.sql
DROP TABLE IF EXISTS token_sessions;
DROP TABLE IF EXISTS project_members;
ALTER TABLE users DROP FOREIGN KEY fk_users_mcn_account;
ALTER TABLE mcn_accounts DROP FOREIGN KEY fk_mcn_accounts_owner;
DROP TABLE IF EXISTS mcn_accounts;
ALTER TABLE users DROP FOREIGN KEY fk_users_role;
ALTER TABLE users
  DROP INDEX idx_users_role_id,
  DROP INDEX idx_users_mcn_account,
  DROP COLUMN role_id,
  DROP COLUMN email,
  DROP COLUMN mcn_account_id;
DROP TABLE IF EXISTS roles;
UPDATE users SET role = 'boss' WHERE role = 'admin';
UPDATE users SET role = 'member' WHERE role = 'creator';
ALTER TABLE users MODIFY role ENUM('boss','leader','member') NOT NULL;
