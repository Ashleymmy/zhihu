import type { RowDataPacket } from 'mysql2/promise';
import type { ModuleAccountLifecycle } from '../../../core/contracts';

export const zhihuAccountLifecycle: ModuleAccountLifecycle = {
  async accessChangeBlockers(c, userId, projectId) {
    const [bindings] = await c.query<RowDataPacket[]>(
      `SELECT b.id FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id
       WHERE (b.leader_id=? OR b.executor_id=?) AND b.released_at IS NULL AND b.stop_new_use_at IS NULL
       ${projectId ? 'AND k.project_id=?' : ''} LIMIT 1 FOR UPDATE`,
      projectId ? [userId, userId, projectId] : [userId, userId],
    );
    return bindings.length
      ? [
          projectId
            ? '该成员在待移除项目中仍有使用中的关键词，请先处理后再移出'
            : '该账号仍有使用中的关键词，请先结束或退回后再调整角色或团队',
        ]
      : [];
  },
  async closureBlockers(c, userId) {
    const checks: Array<[string, string, string[]]> = [
      [
        '请先完成或解除正在使用的关键词分配',
        'SELECT id FROM zh_keyword_bindings WHERE (executor_id=? OR leader_id=?) AND released_at IS NULL LIMIT 1',
        [userId, userId],
      ],
      [
        '请先处理进行中的作品和计划',
        "SELECT id FROM compositions WHERE owner_id=? AND (status IN ('pending','active') OR sync_status IN ('local','syncing')) LIMIT 1",
        [userId],
      ],
      [
        '请先处理进行中的计划',
        "SELECT id FROM plans WHERE owner_id=? AND (status IN ('pending','active','paused') OR sync_status IN ('local','syncing')) LIMIT 1",
        [userId],
      ],
      [
        '请先处理历史提现申请',
        "SELECT id FROM withdrawal_requests WHERE user_id=? AND status='pending' LIMIT 1",
        [userId],
      ],
      [
        '请先核清历史收益',
        "SELECT id FROM earnings WHERE user_id=? AND status<>'paid' AND amount<>0 LIMIT 1",
        [userId],
      ],
    ];
    const reasons: string[] = [];
    for (const [label, sql, params] of checks) {
      const [rows] = await c.query<RowDataPacket[]>(sql, params);
      if (rows.length) reasons.push(label);
    }
    return reasons;
  },
  async erasePersonalData(c, userId) {
    await c.query('UPDATE users SET zhihu_uid=NULL WHERE id=?', [userId]);
  },
};
