// The full-page audit cold-loads more pages per minute than a person can navigate.
// Keep that load separate from limiter tests, without altering production limits.
import './host';
if (process.env.ATTRIBUTION_UI_TEST !== '1') throw new Error('Isolated UI tests only');
process.on('message', message => {
  if (message === 'seed-audit-data') {
    void (async () => {
      const { db } = await import('../../src/db');
      await db.query("INSERT INTO earnings(user_id,project_id,plan_id,settle_date,amount,status) VALUES(3,1,901,'2026-09-20',12345,'confirmed')");
      process.send?.({ auditDataSeeded: true });
    })();
    return;
  }
  if (message !== 'reset-audit-limit') return;
  void (async () => {
    const { deleteRateLimit } = await import('../../src/utils/rateLimit');
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1', 'unknown']) await deleteRateLimit('api:anon:' + ip);
    for (const id of ['1', '2', '3']) await deleteRateLimit('api:user:' + id);
    process.send?.({ auditLimitReset: true });
  })();
});
