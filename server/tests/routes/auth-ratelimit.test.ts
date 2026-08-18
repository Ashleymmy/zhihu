import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  rows: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: { query: dbMocks.query },
  rows: dbMocks.rows,
  withTransaction: dbMocks.withTransaction,
}));

import { createApp } from '../../src/app';

describe('POST /api/v1/auth/login - 限流', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.withTransaction.mockReset();
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('IP 限流：连续 20 次后被拒绝', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '192.168.1.100')
        .send({ username: `user${i}`, password: 'any' });
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '192.168.1.100')
      .send({ username: 'user99', password: 'any' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe(42903);
    expect(res.body.message).toContain('5 分钟');
    expect(dbMocks.rows).toHaveBeenCalledTimes(20);
    expect(dbMocks.query).not.toHaveBeenCalled();
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  }, 15000);

  it('用户名失败限流：连续 5 次失败后被拒绝', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `192.168.1.${i}`)
        .send({ username: 'testuser', password: 'wrong' });
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '192.168.1.99')
      .send({ username: 'testuser', password: 'wrong' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe(42903);
    expect(res.body.message).toContain('15 分钟');
    expect(dbMocks.rows).toHaveBeenCalledTimes(6);
    expect(dbMocks.query).not.toHaveBeenCalled();
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  }, 15000);

  it('不同用户名的限流独立', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `192.168.2.${i}`)
        .send({ username: 'alice', password: 'wrong' });
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '192.168.2.99')
      .send({ username: 'bob', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(40102);
    expect(dbMocks.rows).toHaveBeenCalledTimes(6);
    expect(dbMocks.query).not.toHaveBeenCalled();
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  }, 15000);
});
