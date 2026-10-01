-- Platform college content is distinct from project-scoped course links.
-- Import the seven existing starter lessons once; do not seed on reads.
-- Legacy seed views were sample counts, not measured learning activity.
CREATE TABLE IF NOT EXISTS college_courses (
 id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 tier ENUM('silver','gold','elite') NOT NULL,
 title VARCHAR(128) NOT NULL,
 cover VARCHAR(1024) NOT NULL DEFAULT '',
 intro VARCHAR(500) NOT NULL DEFAULT '',
 duration VARCHAR(32) NOT NULL DEFAULT '',
 sections JSON NOT NULL,
 display_order INT NOT NULL DEFAULT 0,
 published TINYINT(1) NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO college_courses (id,tier,title,cover,intro,duration,sections,display_order) VALUES
('seed-silver-1','silver','认识知乎推广','','了解知乎关键词推广的基本玩法、结算链路和平台规则','6 分钟','[{"title":"什么是关键词推广","content":"达人为指定知乎关键词创作内容（文章或视频），用户通过关键词搜索看到你的作品并产生有效行为后，按规则结算收益。"},{"title":"结算是怎么来的","content":"平台定期导出报表，财务核对后按关键词归因到具体作品与达人，确认开放后即可在钱包申请提现。"}]',1),
('seed-silver-2','silver','领取与提交第一单','','从领取关键词到提交作品回填的完整操作演示','8 分钟','[{"title":"领取关键词","content":"在关键词页选择「可领取」的关键词，确认后在规定时间内完成内容发布。"},{"title":"提交作品回填","content":"发布成功后回到关键词页，点击「立即回填」提交作品链接、发布日期与作品类型，等待审核。"}]',2),
('seed-silver-3','silver','审核常见退回原因','','链接打不开、关键词不符、发布时间异常等高频问题自查清单','5 分钟','[{"title":"链接有效性","content":"提交前自己先点开链接确认能正常访问，注意区分文章链接与视频链接。"},{"title":"内容相关性","content":"作品内容必须与关键词主题直接相关，标题或开头建议自然包含关键词。"}]',3),
('seed-gold-1','gold','爆款标题怎么写','','高点击率标题的结构模板与避坑指南','10 分钟','[{"title":"标题结构","content":"数字+痛点+悬念是最稳定的三件套，避免夸大宣传和平台违禁词。"},{"title":"关键词植入","content":"关键词要自然出现在标题前 15 个字内，生硬堆砌会被判定低质。"}]',1),
('seed-gold-2','gold','稳定产出的工作流','','从选题库到批量回填，建立每周稳定产出的节奏','12 分钟','[{"title":"选题库","content":"把可领取的关键词按主题分组，提前一周排好发布计划。"},{"title":"批量回填","content":"多条作品用 xlsx 批量回填，注意每条的平台账号与发布日期要对应准确。"}]',2),
('seed-elite-1','elite','高转化内容策略','','从曝光到有效行为的转化漏斗拆解与优化方法','15 分钟','[{"title":"转化漏斗","content":"曝光→点击→有效行为，每一层都有可优化的杠杆：封面、开头、引导语。"},{"title":"复盘方法","content":"每周对比收益报表中不同关键词的表现，把预算倾斜到高转化主题。"}]',1),
('seed-elite-2','elite','看懂收益报表','','报表字段口径、异常处理和更正流程的完整说明','9 分钟','[{"title":"口径说明","content":"已确认金额是财务核对完成的可结算部分；待确认金额在下一期报表核对后更新。"},{"title":"异常处理","content":"报表异常会进入待核对状态，期间相关款项暂停使用，核对完成后自动恢复。"}]',2);
