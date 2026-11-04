import request, { type Response } from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientIdHash } from '../../src/auth/clientIdentity';
import { signToken, verifyToken } from '../../src/auth/jwt';
import { permissionsFor } from '../../src/auth/permissions';
import { createCoreApp } from '../../src/core/app';
import { isDevDemoEnabled } from '../../src/core/demo';
import { unitAuthRows, unitClientId, unitSessionId } from '../support/unitAuthSession';

const { auditQuery, authQuery } = vi.hoisted(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DEV_DEMO_AUTH', '0');
  return { auditQuery: vi.fn(), authQuery: vi.fn() };
});

vi.mock('../../src/db', async (original) => ({
  ...(await original<typeof import('../../src/db')>()),
  rows: vi.fn((sql: string, bindings: unknown[] = []) =>
    /\baudit_logs\b/.test(sql) ? auditQuery(sql, bindings) : authQuery(sql, bindings),
  ),
}));

const accounts = [
  { id: '1', label: '全部职责管理员', role: 'admin', adminDuty: 'all', status: 200 },
  { id: '2', label: '开发者', role: 'developer', adminDuty: 'all', status: 200 },
  { id: '3', label: '普通运营', role: 'operator', adminDuty: 'operations', status: 403 },
  { id: '4', label: '运营职责管理员', role: 'admin', adminDuty: 'operations', status: 403 },
  { id: '5', label: '财务职责管理员', role: 'admin', adminDuty: 'finance', status: 403 },
  { id: '6', label: '团长', role: 'leader', adminDuty: 'all', status: 403 },
  { id: '7', label: '达人', role: 'creator', adminDuty: 'all', status: 403 },
] as const;

const endpoints = [
  { path: '/api/v1/core/audit-logs', actions: false },
  { path: '/api/v1/core/audit-logs/actions', actions: true },
  { path: '/api/v1/audit-logs', actions: false },
  { path: '/api/v1/audit-logs/actions', actions: true },
] as const;

const auditRow = {
  id: '101',
  action: 'staff.duty_update',
  resource_type: 'user',
  resource_id: '4',
  detail_json: { before: 'all', after: 'operations' },
  ip: '127.0.0.1',
  created_at: '2026-11-04T00:00:00.000Z',
  operator_username: 'admin',
  operator_name: '全部职责管理员',
};
const auditActions = [{ action: auditRow.action }];
const app = createCoreApp();
let users: Parameters<typeof unitAuthRows>[0];

beforeEach(() => {
  users = Object.fromEntries(
    accounts.map(({ id, role, adminDuty }) => [id, { role, admin_duty: adminDuty }]),
  );
  authQuery.mockReset().mockImplementation(unitAuthRows(users));
  auditQuery.mockReset().mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT COUNT(*) total FROM audit_logs ')) return [{ total: 1 }];
    if (sql.startsWith('SELECT a.id, a.action,') && sql.includes('FROM audit_logs a')) return [auditRow];
    if (sql === 'SELECT DISTINCT action FROM audit_logs ORDER BY action') return auditActions;
    throw new Error('Unexpected audit query: ' + sql);
  });
  expect(process.env.NODE_ENV).toBe('test');
  expect(isDevDemoEnabled()).toBe(false);
});

afterAll(() => vi.unstubAllEnvs());

function expectValidSession(userId: string) {
  expect(authQuery).toHaveBeenCalledTimes(2);
  expect(authQuery).toHaveBeenNthCalledWith(
    1,
    'SELECT role,is_active,admin_duty,parent_id FROM users WHERE id=?',
    [userId],
  );
  expect(authQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM login_sessions'), [
    unitSessionId(userId),
    userId,
    'web',
    clientIdHash(unitClientId),
  ]);
}

function expectAuditRead(response: Response, actions: boolean) {
  expect(response.status).toBe(200);
  if (actions) {
    expect(response.body).toEqual({ code: 0, data: auditActions, message: 'ok' });
    expect(auditQuery).toHaveBeenCalledExactlyOnceWith(
      'SELECT DISTINCT action FROM audit_logs ORDER BY action',
      [],
    );
    return;
  }
  expect(response.body).toEqual({
    code: 0,
    message: 'ok',
    data: {
      list: [
        {
          id: auditRow.id,
          action: auditRow.action,
          resourceType: auditRow.resource_type,
          resourceId: auditRow.resource_id,
          detailJson: auditRow.detail_json,
          ip: auditRow.ip,
          createdAt: auditRow.created_at,
          operatorUsername: auditRow.operator_username,
          operatorName: auditRow.operator_name,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  });
  expect(auditQuery).toHaveBeenCalledTimes(2);
  expect(auditQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('SELECT COUNT(*) total FROM audit_logs '), []);
  expect(auditQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM audit_logs a'), [20, 0]);
}

describe.each(endpoints)('审计读取岗位边界 $path', ({ path, actions }) => {
  it.each(accounts)('$label 经有效认证后返回 $status', async ({ id, role, adminDuty, status, label }) => {
    if (role === 'admin') expect(permissionsFor(role)).toContain('audit.view');
    const token = await signToken({
      id,
      role,
      adminDuty,
      parentId: null,
      username: 'audit-user-' + id,
      displayName: label,
      sessionId: unitSessionId(id),
    });
    const response = await request(app)
      .get(path)
      .set('X-Client-Id', unitClientId)
      .auth(token, { type: 'bearer' });

    expectValidSession(id);
    if (status === 200) {
      expectAuditRead(response, actions);
    } else {
      expect.soft(response.status).toBe(403);
      expect.soft(response.body).toMatchObject({ code: 40301, data: null });
      expect.soft(auditQuery).not.toHaveBeenCalled();
    }
  });

  it('匿名请求返回 401，且不查询审计数据', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 40100, data: null, message: '请先登录' });
    expect(authQuery).not.toHaveBeenCalled();
    expect(auditQuery).not.toHaveBeenCalled();
  });

  it.each([
    { tokenRole: 'admin', adminDuty: 'operations' },
    { tokenRole: 'admin', adminDuty: 'finance' },
    { tokenRole: 'developer', adminDuty: 'operations' },
    { tokenRole: 'developer', adminDuty: 'finance' },
  ] as const)('数据库当前 $adminDuty 岗位覆盖旧 $tokenRole 全部职责 token', async ({ tokenRole, adminDuty }) => {
    const token = await signToken({
      id: '1',
      role: tokenRole,
      adminDuty: 'all',
      parentId: null,
      username: 'admin',
      displayName: '全部职责管理员',
      sessionId: unitSessionId('1'),
    });
    expect(permissionsFor('admin')).toContain('audit.view');
    expect(verifyToken(token)).toMatchObject({ role: tokenRole, adminDuty: 'all' });
    expect(users['1']).toMatchObject({ role: 'admin', admin_duty: 'all' });
    const allowed = await request(app)
      .get(path)
      .set('X-Client-Id', unitClientId)
      .auth(token, { type: 'bearer' });
    expectValidSession('1');
    expectAuditRead(allowed, actions);

    users['1'].admin_duty = adminDuty;
    expect(users['1']).toMatchObject({ role: 'admin', admin_duty: adminDuty });
    authQuery.mockClear();
    auditQuery.mockClear();
    const denied = await request(app)
      .get(path)
      .set('X-Client-Id', unitClientId)
      .auth(token, { type: 'bearer' });

    expectValidSession('1');
    expect.soft(denied.status).toBe(403);
    expect.soft(denied.body).toMatchObject({ code: 40301, data: null });
    expect.soft(auditQuery).not.toHaveBeenCalled();
  });
});
