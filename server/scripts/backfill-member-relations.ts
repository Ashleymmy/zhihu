/**
 * 成员关系回填（P0）：邀请关系、邀请树闭包、团队归属、角色历史。
 * 用法：npx tsx scripts/backfill-member-relations.ts [--apply]
 * 默认只预览：在事务里试跑并输出数量与核对结果，然后回滚。加 --apply 且核对全部通过才提交。
 * 每一步只补缺失的记录，重复执行不会产生重复数据。
 */
export async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== '--apply'))
    throw Error('用法：npx tsx scripts/backfill-member-relations.ts [--apply]；默认仅预览，不写入');
  const apply = args.includes('--apply');
  const { db } = await import('../src/db');
  const { backfillMemberRelations, checkMemberRelations } = await import('../src/core/member-relations');
  const connection = await db.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.query<import('mysql2/promise').RowDataPacket[]>(
      "SELECT GET_LOCK('member-relations-backfill',0) got",
    );
    if (Number(lock?.got) !== 1) throw Error('另一个成员关系回填正在运行，请稍后再试');
    locked = true;
    await connection.beginTransaction();
    const counts = await backfillMemberRelations(connection);
    const check = await checkMemberRelations(connection);
    if (apply && check.ok) await connection.commit();
    else await connection.rollback();
    console.log(
      JSON.stringify(
        { mode: apply ? (check.ok ? '已写入' : '核对未通过，已放弃写入') : '预览（未写入）', counts, check },
        null,
        2,
      ),
    );
    if (apply && !check.ok) process.exitCode = 1;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('member-relations-backfill')").catch(() => undefined);
    connection.release();
    await db.end();
  }
}
if (require.main === module)
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
