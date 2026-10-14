-- IDs are immutable aliases of the existing primary key; old usernames remain usable.
-- Fail before deployment if a legacy username conflicts or an ID exceeds six digits.
CREATE TEMPORARY TABLE user_id_namespace_guard (ok TINYINT NOT NULL CHECK(ok=1));
INSERT INTO user_id_namespace_guard SELECT 0 FROM users u WHERE u.id<1 OR u.id>999999
  OR (LOWER(u.username) REGEXP '^timo[0-9]{6}$' AND LOWER(u.username)<>CONCAT('timo',LPAD(u.id,6,'0')))
  OR (LOWER(u.username) REGEXP '^timo-[1-9][0-9]*$' AND LOWER(u.username)<>CONCAT('timo-',u.id)) LIMIT 1;
DROP TEMPORARY TABLE user_id_namespace_guard;
ALTER TABLE users ADD COLUMN password_set TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN avatar_version CHAR(64) NULL;
CREATE TABLE user_avatars (
  user_id BIGINT PRIMARY KEY,
  mime_type VARCHAR(32) NOT NULL,
  content MEDIUMBLOB NOT NULL,
  content_hash CHAR(64) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_avatar_owner FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
