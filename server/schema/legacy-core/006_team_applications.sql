-- 达人入团申请：creator 向 leader 发起申请，leader/admin 审批通过后建立 parent_id 归属

CREATE TABLE IF NOT EXISTS team_applications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  creator_id BIGINT NOT NULL COMMENT '申请的达人用户 ID',
  leader_id BIGINT NOT NULL COMMENT '目标团长用户 ID',
  message VARCHAR(500) NULL COMMENT '申请留言',
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  handled_by BIGINT NULL COMMENT '审批人用户 ID',
  handled_at DATETIME NULL COMMENT '审批时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_team_applications_creator FOREIGN KEY (creator_id) REFERENCES users(id),
  CONSTRAINT fk_team_applications_leader FOREIGN KEY (leader_id) REFERENCES users(id),
  INDEX idx_team_applications_leader_status (leader_id, status),
  INDEX idx_team_applications_creator (creator_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='达人入团申请';
