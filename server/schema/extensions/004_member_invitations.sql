CREATE TABLE member_invitations (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 owner_user_id BIGINT NOT NULL,
 team_leader_id BIGINT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE,
 label VARCHAR(100) NOT NULL,
 max_uses INT NOT NULL DEFAULT 20,
 used_count INT NOT NULL DEFAULT 0,
 expires_at DATETIME(3) NOT NULL,
 revoked_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX ix_invitation_owner(owner_user_id,created_at),
 FOREIGN KEY(owner_user_id) REFERENCES users(id),
 FOREIGN KEY(team_leader_id) REFERENCES users(id),
 CHECK(max_uses BETWEEN 1 AND 1000),
 CHECK(used_count BETWEEN 0 AND max_uses)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE member_invitation_uses (
 user_id BIGINT PRIMARY KEY,
 invitation_id BIGINT NOT NULL,
 registered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(invitation_id) REFERENCES member_invitations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
