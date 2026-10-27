import { db } from '../src/db';
import { backfillUserIds } from '../src/auth/user-id';
import { writeAudit } from '../src/services/audit.service';

/** Requires 025_random_user_ids.sql. Dry-run unless --apply is explicitly supplied. */
async function main() {
  const apply = process.argv.includes('--apply');
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const changes = await backfillUserIds(c);
    if (apply && changes.length) await writeAudit({
      userId: null,
      action: 'users.public_ids_migrated', resourceType: 'user_identifier',
      detail: { source: 'random-public-id-migration', changes },
    }, c);
    if (apply) await c.commit(); else await c.rollback();
    console.log(JSON.stringify({ applied: apply, changed: changes.length, changes }));
  } catch (error) {
    await c.rollback();
    throw error;
  } finally { c.release(); }
}
if (require.main === module) void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'User ID migration failed');
  process.exitCode = 1;
}).finally(() => db.end());
