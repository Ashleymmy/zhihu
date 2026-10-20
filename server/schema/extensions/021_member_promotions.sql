-- 晋升单（P1b）：运营提名 → 另一位运营或完整管理员审核 → 通过时同一事务写角色、团队归属和跟随成员。
-- 每人同一时刻最多一张进行中的晋升单；评估指标只用业务数据，不使用邀请人数。

CREATE TABLE IF NOT EXISTS member_promotions (
  id               BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id          BIGINT NOT NULL,
  status ENUM('candidate','proposed','approved','rejected','cancelled') NOT NULL DEFAULT 'proposed',
  trigger_type     ENUM('metric','manual') NOT NULL,
  metrics_snapshot JSON NOT NULL COMMENT '提名时的业务指标（不含邀请人数和金额）',
  member_plan      JSON NULL COMMENT '审核通过时其直接邀请成员的去向：[{userId,name,action:follow|stay,fromLeaderId}]',
  from_leader_id   BIGINT NULL COMMENT '提名时所在团队的团长，NULL 为平台直管',
  note             VARCHAR(500) NOT NULL COMMENT '提名理由',
  open_user        BIGINT GENERATED ALWAYS AS
                     (CASE WHEN status IN ('candidate','proposed') THEN user_id END) STORED,
  proposed_by      BIGINT NULL,
  proposed_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_by      BIGINT NULL,
  decided_at       DATETIME(3) NULL,
  review_note      VARCHAR(500) NULL COMMENT '通过备注、退回或取消原因',
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_promotion_open (open_user),
  KEY ix_promotion_status (status, proposed_at),
  KEY ix_promotion_user (user_id, proposed_at),
  CONSTRAINT fk_promotion_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_promotion_reviewer CHECK (status <> 'approved' OR reviewed_by IS NULL OR proposed_by IS NULL OR reviewed_by <> proposed_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='晋升单';
