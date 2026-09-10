-- 014: 添加知乎审核状态 JSON 字段到推广计划和作品表
-- 用于存储从知乎 API 同步回来的审核状态、拒绝原因等信息

ALTER TABLE plans
ADD COLUMN zhihu_status_json TEXT NULL COMMENT '知乎返回的状态详情（JSON）：status, audit_status, reject_reason';

ALTER TABLE compositions
ADD COLUMN zhihu_status_json TEXT NULL COMMENT '知乎返回的状态详情（JSON）：status, audit_status, reject_reason';
