import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// Only called by review-host against a disposable testcontainer.
export async function seedWorkRegistrations(c: Connection) {
  for (const role of ['operator', 'developer'])
    await c.query(
      'INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) SELECT ?,password_hash,?,?,1,0 FROM users WHERE username=?',
      ['review_' + role, role, role, 'review_ops'],
    );
  const [[task]] = await c.query<RowDataPacket[]>('SELECT * FROM tasks ORDER BY id LIMIT 1');
  const [[channel]] = await c.query<RowDataPacket[]>('SELECT * FROM channels ORDER BY id LIMIT 1');
  const [[mapping]] = await c.query<RowDataPacket[]>(
    'SELECT * FROM zh_channel_mappings WHERE project_id=1 ORDER BY id LIMIT 1',
  );
  for (const owner of [2, 3, 5]) {
    const [plan] = await c.query<ResultSetHeader>(
      "INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,status,sync_status,zhihu_plan_id) VALUES(1,?,?,?,'https://example.com/original',1,?,1,'active','synced',?)",
      [task.zhihu_task_id, channel.zhihu_channel_id, '每日登记验收' + owner, owner, 'registration-' + owner],
    );
    await c.query("UPDATE plans SET name=?,novel_title=?,created_at='2026-10-05' WHERE id=?", [
      '回传计划' + owner,
      '原著小说' + owner,
      plan.insertId,
    ]);
    const [word] = await c.query<ResultSetHeader>(
      "INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by,lifecycle_status) VALUES(?,1,?,?,?,?,1,'assigned')",
      [mapping.account_id, task.id, mapping.id, plan.insertId, '每日登记验收' + owner],
    );
    const [binding] = await c.query<ResultSetHeader>(
      "INSERT INTO zh_keyword_bindings(keyword_id,path_type,leader_id,executor_id,relation_snapshot,claimed_at,assigned_at) VALUES(?,?,?,?,'{}','2026-10-10','2026-10-10')",
      [
        word.insertId,
        owner === 2 ? 'leader_self' : owner === 3 ? 'team_creator' : 'direct_creator',
        owner === 5 ? null : 2,
        owner,
      ],
    );
    await c.query('UPDATE zh_keywords SET current_binding_id=? WHERE id=?', [binding.insertId, word.insertId]);
    for (const [index, status, at] of [
      [1, 'synced', '2026-10-10 00:00:00'],
      [2, 'synced', '2026-10-12 23:59:59'],
      [3, 'failed', '2026-10-10 12:00:00'],
      [4, 'local', '2026-10-10 12:00:00'],
    ] as const) {
      await c.query(
        "INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,title,promo_url,release_time,created_at,sync_status,zhihu_composition_id) VALUES(?,?,'KOC抖音','000123456789012345',1,1,?,?,'2026-10-09 12:00:00',?,?,?)",
        [
          plan.insertId,
          owner,
          '登记作品' + index,
          `https://example.com/works/${owner}/${index}?source=${'x'.repeat(280)}&mst=complete-tail`,
          at,
          status,
          status === 'synced' ? `receipt-${owner}-${index}` : null,
        ],
      );
    }
  }
  await c.query(
    "INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,sync_status,sync_error,created_at) VALUES(1,?,?,'日期导出失败验收','https://example.com/failed',1,1,1,'failed','invalid URL','2026-10-11')",
    [task.zhihu_task_id, channel.zhihu_channel_id],
  );
}
