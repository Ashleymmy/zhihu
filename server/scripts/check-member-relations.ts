/**
 * 成员关系一致性核对：只读，不修改数据。核对不通过时退出码为 1。
 * 用法：npx tsx scripts/check-member-relations.ts
 */
export async function main() {
  const { db } = await import('../src/db');
  const { checkMemberRelations } = await import('../src/core/member-relations');
  try {
    const result = await checkMemberRelations(db);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await db.end();
  }
}
if (require.main === module)
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
