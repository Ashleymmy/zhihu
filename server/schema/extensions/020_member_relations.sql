-- 成员关系底座（P0）：邀请关系、邀请树闭包、团队归属历史、角色变更历史。
-- 只新增表，不改旧表。users.parent_id 继续作为「当前团长」缓存，与 team_memberships 同事务双写。
-- 历史数据由 scripts/backfill-member-relations.ts 回填（默认只预览，加 --apply 才写入）。

-- 邀请关系：每个用户至多一条，注册时写入，之后不再修改（纠错除外）
CREATE TABLE IF NOT EXISTS member_referrals (
  user_id        BIGINT PRIMARY KEY,
  inviter_id     BIGINT NULL COMMENT '直接邀请人，NULL 表示自然注册或历史数据无法追溯',
  invitation_id  BIGINT NULL COMMENT '来源邀请链接',
  channel ENUM('leader_invite','creator_invite','staff_invite','leader_created',
               'organic','admin_assign','migration') NOT NULL COMMENT '注册当时的来源',
  registered_at  DATETIME(3) NOT NULL,
  corrected_from BIGINT NULL COMMENT '纠错前的邀请人',
  corrected_by   BIGINT NULL,
  corrected_at   DATETIME(3) NULL,
  correction_reason VARCHAR(500) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_referral_inviter (inviter_id, registered_at),
  CONSTRAINT fk_referral_user    FOREIGN KEY (user_id)       REFERENCES users(id),
  CONSTRAINT fk_referral_inviter FOREIGN KEY (inviter_id)    REFERENCES users(id),
  CONSTRAINT fk_referral_link    FOREIGN KEY (invitation_id) REFERENCES member_invitations(id),
  CONSTRAINT ck_referral_not_self CHECK (inviter_id IS NULL OR inviter_id <> user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邀请关系（不可变）';

-- 邀请树闭包：分层人数和子树查询不需要递归，只增不改，纠错时重建子树
CREATE TABLE IF NOT EXISTS member_referral_closure (
  ancestor_id   BIGINT NOT NULL,
  descendant_id BIGINT NOT NULL,
  depth         SMALLINT NOT NULL COMMENT '1 表示直接邀请',
  PRIMARY KEY (ancestor_id, descendant_id),
  KEY ix_closure_desc      (descendant_id, depth),
  KEY ix_closure_anc_depth (ancestor_id, depth),
  CONSTRAINT fk_closure_ancestor   FOREIGN KEY (ancestor_id)   REFERENCES users(id),
  CONSTRAINT fk_closure_descendant FOREIGN KEY (descendant_id) REFERENCES users(id),
  CONSTRAINT ck_closure_depth CHECK (depth >= 1),
  CONSTRAINT ck_closure_not_self CHECK (ancestor_id <> descendant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邀请树闭包';

-- 团队归属历史：每人同一时刻只有一条有效记录，leader_id 为 NULL 表示平台直管
CREATE TABLE IF NOT EXISTS team_memberships (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id        BIGINT NOT NULL,
  leader_id      BIGINT NULL COMMENT 'NULL 表示平台直管（独立达人、团长本人或员工名下）',
  source ENUM('registration','invitation_accept','application','transfer',
              'promotion','demotion','removal','closure','migration') NOT NULL,
  effective_from DATETIME(3) NOT NULL,
  effective_to   DATETIME(3) NULL,
  open_user      BIGINT GENERATED ALWAYS AS (CASE WHEN effective_to IS NULL THEN user_id END) STORED,
  ref_type       VARCHAR(32) NULL COMMENT 'team_application / invitation / account_edit',
  ref_id         BIGINT NULL,
  reason         VARCHAR(500) NULL,
  operator_id    BIGINT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_team_open (open_user),
  KEY ix_team_user_time   (user_id, effective_from),
  KEY ix_team_leader_time (leader_id, effective_from),
  CONSTRAINT fk_team_user   FOREIGN KEY (user_id)   REFERENCES users(id),
  CONSTRAINT fk_team_leader FOREIGN KEY (leader_id) REFERENCES users(id),
  CONSTRAINT ck_team_period CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_team_not_self CHECK (leader_id IS NULL OR leader_id <> user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='团队归属历史';

-- 角色变更历史
CREATE TABLE IF NOT EXISTS member_role_history (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT NOT NULL,
  from_role    VARCHAR(16) NULL,
  to_role      VARCHAR(16) NOT NULL,
  reason       ENUM('registration','promotion','demotion','manual','migration') NOT NULL,
  promotion_id BIGINT NULL,
  operator_id  BIGINT NULL,
  effective_at DATETIME(3) NOT NULL,
  note         VARCHAR(500) NULL,
  KEY ix_role_history_user (user_id, effective_at),
  CONSTRAINT fk_role_history_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色变更历史';
