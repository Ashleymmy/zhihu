import { createApp } from '../../src/app';
import { db } from '../../src/db';
import { closeQueue } from '../../src/queue';
import { closeRateLimiter } from '../../src/utils/rateLimit';
import { revocationStore } from '../../src/auth/revocation';
if (process.env.OPC_UI_SMOKE !== '1' || process.env.DEV_DEMO_AUTH !== '1' || process.env.DB_PORT !== '1')
  throw Error('UI harness requires isolated demo configuration');
const app = createApp();
const server = app.listen(0, '127.0.0.1', () => {
  process.send?.({ port: (server.address() as { port: number }).port });
});
process.on('message', async (message) => {
  if (message !== 'stop') return;
  server.close();
  server.closeAllConnections();
  await Promise.allSettled([db.end(), closeQueue(), closeRateLimiter(), revocationStore.close()]);
  process.disconnect?.();
});
