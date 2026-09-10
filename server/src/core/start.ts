import { createCoreApp } from './app';
import { config } from '../config';
import { db } from '../db';
import { closeQueue } from '../queue';
import { revocationStore } from '../auth/revocation';
import { closeRateLimiter } from '../utils/rateLimit';
const server = createCoreApp().listen(config.port, () => console.log('OPC core listening on ' + config.port));
async function shutdown() {
  server.close();
  await Promise.all([db.end(), closeQueue(), revocationStore.close(), closeRateLimiter()]);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
