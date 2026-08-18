import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  rows: vi.fn(),
  withTransaction: vi.fn(),
  connectionQuery: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: { query: dbMocks.query },
  rows: dbMocks.rows,
  withTransaction: dbMocks.withTransaction,
}));

import { createApp } from '../../src/app';

const sha256 = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest();

const passwordHash = bcrypt.hashSync('secret123', 4);

const userRow = (role: string) => ({
  id: '1',
  username: 'alice',
  password_hash: passwordHash,
  role,
  parent_id: null,
  display_name: 'Alice',
  phone: null,
  is_active: 1,
  must_change_pwd: 0,
});

describe('认证：角色迁移与 Refresh Token 轮换', () => {
  let app: Express;

  beforeEach(() => {
    dbMocks.query.mockReset();
    dbMocks.rows.mockReset().mockResolvedValue([]);
    dbMocks.connectionQuery.mockReset().mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);
    dbMocks.withTransaction.mockReset().mockImplementation(async (work: (c: unknown) => Promise<unknown>) => {
      return work({ query: dbMocks.connectionQuery });
    });
    process.env.QUEUE_DRIVER = 'memory';
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('登录：旧库 boss 角色输出 admin，并写入 Refresh Cookie；Refresh Token 不出现在 JSON 中', async () => {
    dbMocks.rows.mockResolvedValue([userRow('boss')]);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ username: 'alice', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('admin');
    expect(res.body.data.refresh).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('zk_refresh');
    const cookies = res.get('Set-Cookie') ?? [];
    const refreshCookie = cookies.find((cookie) => cookie.startsWith('zk_refresh='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('Path=/api/v1/auth');
    expect(refreshCookie).toContain('SameSite=Lax');
  });

  it('登录：未知角色值拒绝并返回 40303', async () => {
    dbMocks.rows.mockResolvedValue([userRow('superuser')]);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ username: 'alice', password: 'secret123' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40303);
  });

  it('刷新：无 Cookie 时返回 401 并清除 Cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(40104);
  });

  it('刷新：有效 Token 单次轮换，换发新 Cookie', async () => {
    const tokenId = crypto.randomUUID();
    const plain = `${tokenId}.${crypto.randomBytes(32).toString('base64url')}`;
    const session = {
      id: '10',
      user_id: '1',
      family_id: crypto.randomUUID(),
      token_id: tokenId,
      refresh_token_hash: sha256(plain),
      expires_at: new Date(Date.now() + 3600_000),
      revoked_at: null,
    };
    dbMocks.connectionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM token_sessions')) return [[session]];
      return [{ insertId: 11, affectedRows: 1 }];
    });
    dbMocks.rows.mockResolvedValue([userRow('member')]);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `zk_refresh=${plain}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('creator');
    expect(res.body.data.token).toBeTruthy();
    const cookies = res.get('Set-Cookie') ?? [];
    const refreshCookie = cookies.find((cookie) => cookie.startsWith('zk_refresh='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).not.toContain(plain);
    const rotateCall = dbMocks.connectionQuery.mock.calls.find(([sql]) =>
      String(sql).includes("revoke_reason = 'rotated'"),
    );
    expect(rotateCall).toBeDefined();
  });

  it('刷新：已撤销 Token 复用触发整个 family 撤销并返回 40105', async () => {
    const tokenId = crypto.randomUUID();
    const plain = `${tokenId}.${crypto.randomBytes(32).toString('base64url')}`;
    const session = {
      id: '10',
      user_id: '1',
      family_id: crypto.randomUUID(),
      token_id: tokenId,
      refresh_token_hash: sha256(plain),
      expires_at: new Date(Date.now() + 3600_000),
      revoked_at: new Date(),
    };
    dbMocks.connectionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM token_sessions')) return [[session]];
      return [{ affectedRows: 1 }];
    });

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `zk_refresh=${plain}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(40105);
    const familyRevoke = dbMocks.connectionQuery.mock.calls.find(
      ([sql, bindings]) =>
        String(sql).includes('WHERE family_id = ?') && (bindings as unknown[])[0] === 'reuse_detected',
    );
    expect(familyRevoke).toBeDefined();
  });

  it('刷新：Token 哈希不匹配拒绝', async () => {
    const tokenId = crypto.randomUUID();
    const plain = `${tokenId}.${crypto.randomBytes(32).toString('base64url')}`;
    const session = {
      id: '10',
      user_id: '1',
      family_id: crypto.randomUUID(),
      token_id: tokenId,
      refresh_token_hash: sha256('another-token'),
      expires_at: new Date(Date.now() + 3600_000),
      revoked_at: null,
    };
    dbMocks.connectionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM token_sessions')) return [[session]];
      return [{ affectedRows: 1 }];
    });
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `zk_refresh=${plain}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(40104);
  });
});
