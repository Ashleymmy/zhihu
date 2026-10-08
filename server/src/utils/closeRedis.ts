interface RedisConnection {
  readonly status?: string;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
}

export async function closeRedis(client: RedisConnection): Promise<void> {
  // Sending QUIT to a lazy client opens a connection during shutdown.
  if (client.status === 'wait' || client.status === 'end') {
    client.disconnect?.();
    return;
  }
  try {
    await client.quit?.();
  } catch {
    // A failed QUIT must still release the socket and stop reconnecting.
  } finally {
    client.disconnect?.();
  }
}
