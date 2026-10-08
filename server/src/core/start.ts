import { createCoreApp } from './app';
import { config } from '../config';
import { createShutdown } from '../shutdown';
const server = createCoreApp().listen(config.port, () => console.log('OPC core listening on ' + config.port));
const shutdown = createShutdown(server);
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
