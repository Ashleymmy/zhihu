import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// Only called by review-host against a disposable testcontainer.
export async function seedWorkRegistrations(c: Connection) {
  for (const role of ['operator','developer']) await c.query('INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) SELECT ?,password_hash,?,?,1,0 FROM users WHERE username=?',['review_'+role,role,role,'review_ops']);
  const [[task]] = await c.query<RowDataPacket[]>('SELECT * FROM tasks ORDER BY id LIMIT 1');
  const [[channel]] = await c.query<RowDataPacket[]>('SELECT * FROM channels ORDER BY id LIMIT 1');
  for (const owner of [2, 3, 5]) {
    const [plan] = await c.query<ResultSetHeader>(
      "INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,status,sync_status,zhihu_plan_id) VALUES(1,?,?,?,'https://example.com/original',1,?,1,'active','synced',?)",
      [task.zhihu_task_id, channel.zhihu_channel_id, '每日登记验收' + owner, owner, 'registration-' + owner],
    );
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
}
