import { config } from '../../../src/config';
import { db } from '../../../src/db';
import { closeQueue } from '../../../src/queue';
import {
  recoverImports,
  registerAttributionJobs,
  startAttributionWorker,
  stopAttributionWorker,
} from '../../../src/modules/zhihu/attribution/worker';

if (process.env.ATTRIBUTION_RECOVERY_TEST !== '1' || config.db.database !== 'attribution_recovery_test')
  throw new Error('仅允许隔离恢复测试');

registerAttributionJobs();
process.on('message', (message) => {
  void (async () => {
    if (message === 'start') {
      startAttributionWorker();
      process.send?.({ type: 'started' });
    } else if (message === 'pause-recovery') {
      stopAttributionWorker();
      process.send?.({ type: 'paused' });
    } else if (message === 'recover') {
      await recoverImports();
      process.send?.({ type: 'delivered' });
    } else if (message === 'stop') {
      stopAttributionWorker();
      await closeQueue();
      await db.end();
      process.disconnect?.();
    }
  })().catch((error: unknown) => {
    process.send?.({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
});
process.send?.({ type: 'ready' });
