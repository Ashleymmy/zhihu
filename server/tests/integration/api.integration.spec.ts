import bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { createApp } from '../../src/app';
import { signToken } from '../../src/auth/jwt';
import { db, rows } from '../../src/db';
import { syncMetrics } from '../../src/jobs/syncMetrics';

const enabled = process.env.RUN_DB_TESTS === '1';
const suite = enabled ? describe : describe.skip;
let metricValue = 12;

const upstream = setupServer(
  http.post('https://open.zhihu.com/alliance/api/popularize_plan', () =>
    HttpResponse.json({ data: { plan_id: '998877665544332211' } }),
  ),
  http.get('https://open.zhihu.com/alliance/api/data_report/daily_data', () =>
    HttpResponse.json({
      data: {
        list: [
          {
            channel_id: 'channel-a',
            keyword: 'test-keyword',
            stat_date: '2026-08-05',
            impressions: metricValue,
            clicks: 2,
            conversions: 1,
            earning: 3.5,
          },
        ],
      },
    }),
  ),
);

suite('MySQL API integration', () => {
  const app = createApp();
  let bossToken = '';
  let leaderToken = '';
  let memberToken = '';
  let createdPlanId = '';

  beforeAll(async () => {
    upstream.listen({
      onUnhandledRequest(request, print) {
        if (new URL(request.url).hostname !== '127.0.0.1') {
          print.error();
        }
      },
    });
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    for (const table of [
      'callback_logs',
      'callback_secrets',
      'callback_rules',
      'audit_logs',
      'withdrawal_requests',
      'earnings',
      'daily_metrics',
      'compositions',
      'plans',
      'tasks',
      'channels',
      'users',
    ]) {
      await db.query(`TRUNCATE TABLE ${table}`);
    }
    await db.query('SET FOREIGN_KEY_CHECKS=1');

    const hash = await bcrypt.hash('password123', 12);
    await db.query(
      `INSERT INTO users
        (id, username, password_hash, role, parent_id, display_name, is_active, must_change_pwd)
       VALUES
        (1, 'boss', ?, 'boss', NULL, 'Boss', 1, 0),
        (2, 'leader-a', ?, 'leader', 1, 'Leader A', 1, 0),
        (3, 'leader-b', ?, 'leader', 1, 'Leader B', 1, 0),
        (4, 'member-a', ?, 'member', 2, 'Member A', 1, 0),
        (5, 'member-b', ?, 'member', 3, 'Member B', 1, 0)`,
      [hash, hash, hash, hash, hash],
    );

    bossToken = await signToken({
      id: '1',
      role: 'boss',
      parentId: null,
      username: 'boss',
      displayName: 'Boss',
    });
    leaderToken = await signToken({
      id: '2',
      role: 'leader',
      parentId: '1',
      username: 'leader-a',
      displayName: 'Leader A',
    });
    memberToken = await signToken({
      id: '4',
      role: 'member',
      parentId: '2',
      username: 'member-a',
      displayName: 'Member A',
    });

    await db.query(
      `INSERT INTO plans
        (id, project_id, zhihu_task_id, channel_id, keyword, landing_url,
         popularize_type, owner_id, created_by, status, sync_status)
       VALUES
        (50, 1, 'task-x', 'other-channel', 'other-keyword',
         'https://example.com/other', 0, 5, 5, 'active', 'synced')`,
    );
  });

  afterAll(async () => {
    upstream.close();
    await db.end();
  });

  it('returns JWT, string IDs, and permissions after login', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'boss', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe('1');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.data.token}`);
    expect(me.body.data.permissions).toContain('audit.view');
  });

  it('creates plans quickly, rejects duplicate binding, and isolates member data', async () => {
    const body = {
      taskId: 'task-a',
      channelId: 'channel-a',
      keyword: 'test-keyword',
      landingUrl: 'https://example.com/a',
      popularizeType: 0,
    };
    const started = Date.now();
    const created = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${memberToken}`)
      .send(body);

    expect(created.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(200);
    expect(created.body.data.id).toMatch(/^\d+$/);
    createdPlanId = created.body.data.id;

    const duplicate = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${memberToken}`)
      .send(body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe(40901);

    const list = await request(app)
      .get('/api/v1/plans')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(
      list.body.data.list.every(
        (item: Record<string, unknown>) => item.ownerId === '4',
      ),
    ).toBe(true);
  });

  it('maps a concurrent keyword binding loser to 40901', async () => {
    const body = {
      taskId: 'task-race',
      channelId: 'channel-race',
      keyword: 'race-keyword',
      landingUrl: 'https://example.com/race',
      popularizeType: 0,
    };
    const call = () => request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${memberToken}`)
      .send(body);

    const results = await Promise.all([call(), call()]);
    expect(results.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(results.find((item) => item.status === 409)?.body.code).toBe(40901);
  });

  it('forces leader-created users into the leader team as members', async () => {
    const response = await request(app)
      .post('/api/v1/team/members')
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({
        username: 'forced-member',
        displayName: 'Forced Member',
        role: 'leader',
        parentId: '3',
      });

    expect(response.status).toBe(201);
    const [member] = await rows<
      { parent_id: string; role: string } & RowDataPacket
    >('SELECT parent_id, role FROM users WHERE id = ?', [response.body.data.id]);
    expect(String(member.parent_id)).toBe('2');
    expect(member.role).toBe('member');
    expect(response.body.data.temporaryPassword).toBeTruthy();
  });

  it('rejects creating another boss account through the subordinate API', async () => {
    const response = await request(app)
      .post('/api/v1/team/members')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({
        username: 'another-boss',
        displayName: 'Another Boss',
        role: 'boss',
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe(42200);
  });

  it('overwrites metrics instead of accumulating repeated syncs', async () => {
    metricValue = 10;
    await syncMetrics({});
    metricValue = 12;
    await syncMetrics({});

    const [metric] = await rows<
      { impressions: number } & RowDataPacket
    >(
      `SELECT impressions
       FROM daily_metrics
       WHERE channel_id = 'channel-a' AND keyword = 'test-keyword'`,
    );
    expect(Number(metric.impressions)).toBe(12);
  });

  it('allows only one concurrent withdrawal to reserve the balance', async () => {
    await db.query(
      `INSERT INTO earnings (user_id, project_id, settle_date, amount, status)
       VALUES (4, 1, '2026-08-01', 100, 'confirmed')`,
    );
    const call = () =>
      request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          amount: 80,
          payMethod: 'alipay',
          payAccount: 'member@example.com',
        });

    const results = await Promise.all([call(), call()]);
    expect(results.map((item) => item.status).sort()).toEqual([201, 422]);
  });

  it('supports callback rule soft deletion', async () => {
    const created = await request(app)
      .post('/api/v1/callbacks/rules')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({
        planId: createdPlanId,
        callbackUrl: 'https://callback.example.com/events',
        events: ['conversion'],
      });
    expect(created.status).toBe(201);

    const removed = await request(app)
      .delete(`/api/v1/callbacks/rules/${created.body.data.id}`)
      .set('Authorization', `Bearer ${bossToken}`);
    expect(removed.status).toBe(200);

    const [rule] = await rows<{ status: string } & RowDataPacket>(
      'SELECT status FROM callback_rules WHERE id = ?',
      [created.body.data.id],
    );
    expect(rule.status).toBe('inactive');
  });

  it('returns only a masked callback secret and stores only ciphertext', async () => {
    const response = await request(app)
      .post('/api/v1/callbacks/secret/rotate')
      .set('Authorization', `Bearer ${bossToken}`);

    expect(response.body.data.signKey).toMatch(/^sk_live_\*{4}[a-f0-9]{4}$/);
    const [secret] = await rows<
      { secret_ciphertext: string } & RowDataPacket
    >(
      'SELECT secret_ciphertext FROM callback_secrets WHERE project_id = 1',
    );
    expect(secret.secret_ciphertext).not.toContain('sk_live_');
  });
});
