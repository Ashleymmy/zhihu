-- Public identifiers share one namespace with retained legacy aliases.
-- A deleted account's identifiers remain reserved and are never reassigned.
CREATE TABLE user_identifiers (
  identifier VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci PRIMARY KEY,
  user_id BIGINT NULL,
  kind ENUM('public','legacy') NOT NULL,
  public_user BIGINT GENERATED ALWAYS AS (CASE WHEN kind='public' THEN user_id ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_public_user(public_user),
  KEY ix_identifier_user(user_id),
  CONSTRAINT fk_identifier_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
