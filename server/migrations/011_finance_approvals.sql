-- 011: 三级财务审批制——提现二级审批与财务申诉

ALTER TABLE withdrawal_requests
  MODIFY COLUMN status ENUM('pending','leader_approved','approved','rejected','cancelled') NOT NULL DEFAULT 'pending' COMMENT 'pending=待团长初审 leader_approved=待管理员终审 approved=已放款',
  ADD COLUMN leader_id BIGINT NULL COMMENT '初审团长' AFTER handled_by,
  ADD COLUMN leader_handled_at DATETIME NULL COMMENT '初审时间' AFTER leader_id,
  ADD COLUMN leader_remark VARCHAR(512) NULL COMMENT '初审备注' AFTER leader_handled_at,
  ADD COLUMN risk_flags JSON NULL COMMENT '自动风控标记：high_freq/new_account_large/zero_data_large' AFTER remark,
  ADD INDEX idx_wd_status (status),
  ADD CONSTRAINT fk_wd_leader FOREIGN KEY (leader_id) REFERENCES users(id);

CREATE TABLE IF NOT EXISTS finance_appeals (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT '申诉人',
  kind VARCHAR(32) NOT NULL COMMENT '补款/扣款/结算异议/其他',
  title VARCHAR(128) NOT NULL,
  content VARCHAR(2000) NOT NULL,
  evidence VARCHAR(2000) NULL COMMENT '证据说明',
  status ENUM('pending','leader_approved','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  leader_id BIGINT NULL,
  leader_remark VARCHAR(512) NULL,
  leader_handled_at DATETIME NULL,
  remark VARCHAR(512) NULL COMMENT '终审备注',
  adjust_amount DECIMAL(14,2) NULL COMMENT '终审调账金额（分，正=补发，负=扣款）',
  handled_by BIGINT NULL,
  handled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_appeals_user (user_id, status),
  INDEX idx_appeals_status (status),
  CONSTRAINT fk_appeals_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_appeals_leader FOREIGN KEY (leader_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='财务申诉（二级审批）';
