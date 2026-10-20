import cron, { type ScheduledTask } from 'node-cron';
import { db } from '../db';
import { logger } from '../utils/logger';
import { acquireRateLimit } from '../utils/rateLimit';
import { checkMemberRelations } from './member-relations';

/** 每天 04:00 巡检成员关系：parent_id 与团队归属是否一致、邀请树是否有环。只记日志，不自动修正。 */
let task: ScheduledTask | null = null;

export async function runRelationCheck() {
  const connection = await db.getConnection();
  try {
    const result = await checkMemberRelations(connection);
    if (result.ok) logger.info({ users: result.users, openMemberships: result.openMemberships }, 'member_relations_ok');
    else logger.warn({ ...result }, 'member_relations_mismatch');
    return result;
  } finally {
    connection.release();
  }
}

export function startRelationCheck(timezone = 'Asia/Shanghai') {
  if (task) return;
  task = cron.schedule(
    '0 4 * * *',
    () => {
      void (async () => {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
        // 多实例部署时只让一个实例执行
        if (!(await acquireRateLimit(`member-relations-check:${day}`, 3_600))) return;
        await runRelationCheck();
      })().catch((error) => logger.error({ err: error }, 'member_relations_check_failed'));
    },
    { timezone },
  );
}

export function stopRelationCheck() {
  task?.stop();
  task = null;
}
