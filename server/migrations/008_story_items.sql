-- 知乎故事子模块通用内容表：盐选榜单/评论截流/风险举报/有声书漫画/内容标签/产品库/素材库
-- 七类轻量资产共用一张表，type 区分模块，避免七张同构空表

CREATE TABLE IF NOT EXISTS story_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  type VARCHAR(32) NOT NULL COMMENT 'salt_pick/comment_watch/risk_report/media/tag/product/asset',
  title VARCHAR(255) NOT NULL COMMENT '标题或名称',
  url VARCHAR(1024) NULL COMMENT '相关链接（内容/素材地址）',
  note VARCHAR(500) NULL COMMENT '备注（场景、状态说明等）',
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  owner_id BIGINT NOT NULL COMMENT '登记人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_story_items_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  INDEX idx_story_items_type (type, status),
  INDEX idx_story_items_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知乎故事子模块通用内容资产';
