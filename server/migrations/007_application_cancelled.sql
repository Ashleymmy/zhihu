-- 入团申请增加"已撤回"状态：达人主动撤回与团长驳回是不同含义

ALTER TABLE team_applications
  MODIFY COLUMN status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending';
