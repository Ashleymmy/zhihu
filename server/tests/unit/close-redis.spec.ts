import { createServer } from 'node:net';
import { once } from 'node:events';
import Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { closeRedis } from '../../src/utils/closeRedis';

describe('Redis shutdown', () => {
  it('does not open a TCP connection when closing an unused lazy Redis client', async () => {
    const connected = vi.fn();
    const server = createServer((socket) => {
      connected();
      socket.destroy();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new Redis({
      host: '127.0.0.1',
      port: (server.address() as { port: number }).port,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);
    try {
      await closeRedis(client);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(connected).not.toHaveBeenCalled();
      expect(client.status).toBe('end');
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it.each([false, true])('releases the socket after ready-client QUIT (failed: %s)', async (failed) => {
    const quit = failed ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue('OK');
    const disconnect = vi.fn();
    await closeRedis({ status: 'ready', quit, disconnect });
    expect(quit).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
