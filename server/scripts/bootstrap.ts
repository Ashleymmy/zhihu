import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2/promise';
import { db } from '../src/db';
import { closeQueue, enqueue } from '../src/queue';
import { logger } from '../src/utils/logger';

/**
 * 生产首启引导（幂等，只在空库时执行）：
 * 1. 创建管理员账号（ADMIN_USERNAME / ADMIN_PASSWORD）
 * 2. 补 zhihu 项目行（结算与计划的归属点）
 * 3. 有真实知乎凭证时自动触发渠道/任务首次同步（两个 ID 不需要手配，同步会拉全量）
 */
async function main() {
  const [userRows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users');
  const isFresh = Number(userRows[0]?.n ?? 0) === 0;

  if (isFresh) {
    const username = process.env.ADMIN_USERNAME ?? 'admin';
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 8) {
      throw new Error('首次部署必须设置 ADMIN_PASSWORD（至少 8 位）');
    }
    const hash = await bcrypt.hash(password, 12);
    await db.query(
      `INSERT INTO users (username, password_hash, role, display_name, is_active, must_change_pwd)
       VALUES (?, ?, 'admin', ?, 1, 1)`,
      [username, hash, process.env.ADMIN_DISPLAY_NAME ?? '系统管理员'],
    );
    logger.info({ username }, 'bootstrap: admin account created');
  } else {
    logger.info('bootstrap: users exist, skip admin seed');
  }

  // zhihu 项目是结算/计划的默认归属（plans.service 用 config.defaultProjectId）
  const [project] = await db.query<RowDataPacket[]>("SELECT id FROM projects WHERE slug = 'zhihu' LIMIT 1");
  if (!project.length) {
    await db.query(
      `INSERT INTO projects (name, slug, api_base_url, sign_method, is_enabled, config_json)
       VALUES ('知乎推广', 'zhihu', 'https://open.zhihu.com', 'hmac_sha256', 1, JSON_OBJECT('withdrawalMinAmount', 100))`,
    );
    logger.info('bootstrap: zhihu project created');
  }

  // 首次启动自动同步渠道与任务（失败不阻塞服务启动）
  const token = process.env.ZHIHU_ACCESS_TOKEN ?? '';
  if (token && !token.startsWith('mock')) {
    await enqueue('sync-channels', { source: 'bootstrap' }, { jobId: `bootstrap-channels-${Date.now()}` });
    await enqueue('sync-tasks', { source: 'bootstrap' }, { jobId: `bootstrap-tasks-${Date.now()}` });
    logger.info('bootstrap: channel/task sync enqueued');
  }

  await closeQueue().catch(() => undefined);
  await db.end();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'bootstrap failed');
  process.exitCode = 1;
});
