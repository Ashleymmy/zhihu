-- M1: 项目课程关联表（最小闭环）
-- 暂时复用 001 的 projects 表作为挂载点，course 信息内联存储

CREATE TABLE IF NOT EXISTS project_courses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL COMMENT '关联的项目 ID（复用 001 projects）',
  course_name VARCHAR(128) NOT NULL COMMENT '课程名称',
  course_url VARCHAR(512) NULL COMMENT '课程链接',
  display_order INT NOT NULL DEFAULT 0 COMMENT '显示顺序',
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  CONSTRAINT fk_project_courses_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  INDEX idx_project_courses_project (project_id),
  INDEX idx_project_courses_order (project_id, display_order)
) ENGINE=InnoDB COMMENT='项目课程关联（M1 最小闭环）';
