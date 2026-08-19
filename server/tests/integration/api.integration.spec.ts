import bcrypt from 'bcryptjs';
import { resolve } from 'node:path';
import type { RowDataPacket } from 'mysql2';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { runMigrations } from '../../scripts/migrationRunner';
import { createMySqlTestLease, type MySqlTestLease } from '../support/mysqlTestLease';
import { productionMigrations } from '../support/migrations';

let metricValue = 12;
let receivedComposition: Record<string, unknown> | null = null;
const gateMessage = '资金链启动 Gate 未关闭';

function serializeRows(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Date) return item.toISOString();
    if (typeof item === 'bigint') return item.toString();
    return item;
  });
}

const upstream = setupServer(
  http.post('https://open.zhihu.com/alliance/api/popularize_plan', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const planId =
      body.keyword === 'v2-keyword'
        ? '2071265453767405652'
        : body.keyword === 'race-keyword'
          ? '2071265453767405651'
          : '2071265453767405650';
    return new HttpResponse(`{"data":{"plan_id":${planId}},"success":true}`, {
      headers: { 'Content-Type': 'application/json' },
    });
  }),
  http.post('https://open.zhihu.com/alliance/api/popularize_composition/v2', async ({ request }) => {
    receivedComposition = (await request.json()) as Record<string, unknown>;
    return new HttpResponse('{"data":{"composition_id":2071266138193975100},"success":true}', {
      headers: { 'Content-Type': 'application/json' },
    });
  }),
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

const suite = process.env.RUN_TESTCONTAINERS === '1' ? describe : describe.skip;

suite('MySQL API integration', () => {
  let lease: MySqlTestLease | undefined;
  let app: ReturnType<typeof import('../../src/app').createApp>;
  let db: typeof import('../../src/db').db;
  let rows: typeof import('../../src/db').rows;
  let signToken: typeof import('../../src/auth/jwt').signToken;
  let syncMetrics: typeof import('../../src/jobs/syncMetrics').syncMetrics;
  let createWithdrawal: typeof import('../../src/services/earnings.service').createWithdrawal;
  let approveWithdrawal: typeof import('../../src/services/earnings.service').approveWithdrawal;
  let rejectWithdrawal: typeof import('../../src/services/earnings.service').rejectWithdrawal;
  let bossToken = '';
  let leaderToken = '';
  let memberToken = '';
  let createdPlanId = '';
  let upstreamStarted = false;
  let databaseOpen = false;

  beforeAll(async () => {
    const createdLease = await createMySqlTestLease();
    lease = createdLease;
    try {
      createdLease.injectEnvironment();
      const migration = await runMigrations(createdLease.migrationTarget, resolve(process.cwd(), 'migrations'));
      expect(migration.applied).toEqual(productionMigrations());
      expect(migration.skipped).toEqual([]);
      vi.resetModules();
      const [{ createApp }, databaseModule, jwtModule, metricsModule, earningsModule] = await Promise.all([
        import('../../src/app'),
        import('../../src/db'),
        import('../../src/auth/jwt'),
        import('../../src/jobs/syncMetrics'),
        import('../../src/services/earnings.service'),
      ]);
      app = createApp();
      db = databaseModule.db;
      databaseOpen = true;
      rows = databaseModule.rows;
      signToken = jwtModule.signToken;
      syncMetrics = metricsModule.syncMetrics;
      createWithdrawal = earningsModule.createWithdrawal;
      approveWithdrawal = earningsModule.approveWithdrawal;
      rejectWithdrawal = earningsModule.rejectWithdrawal;

      const [identity] = await rows<{ currentDatabase: string } & RowDataPacket>(
        'SELECT DATABASE() AS currentDatabase',
      );
      expect(identity.currentDatabase).toBe(createdLease.metadata.database);

      upstream.listen({
        onUnhandledRequest(request, print) {
          if (new URL(request.url).hostname !== '127.0.0.1') {
            print.error();
          }
        },
      });
      upstreamStarted = true;

      const hash = await bcrypt.hash('password123', 12);
      await db.query(
        `INSERT INTO users
        (id, username, password_hash, role, parent_id, display_name, is_active, must_change_pwd)
       VALUES
        (1, 'admin', ?, 'admin', NULL, 'Boss', 1, 0),
        (2, 'leader-a', ?, 'leader', 1, 'Leader A', 1, 0),
        (3, 'leader-b', ?, 'leader', 1, 'Leader B', 1, 0),
        (4, 'member-a', ?, 'creator', 2, 'Member A', 1, 0),
        (5, 'member-b', ?, 'creator', 3, 'Member B', 1, 0)`,
        [hash, hash, hash, hash, hash],
      );

      bossToken = await signToken({
        id: '1',
        role: 'admin',
        parentId: null,
        username: 'admin',
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
        role: 'creator',
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
      await db.query(
        `INSERT INTO earnings (id, user_id, project_id, plan_id, settle_date, amount, status)
         VALUES (900, 4, 1, 50, '2026-08-01', 100, 'confirmed')`,
      );
      await db.query(
        `INSERT INTO withdrawal_requests (id, user_id, amount, pay_method, pay_account, status)
         VALUES
           (901, 4, 20, 'alipay', 'member@example.com', 'pending'),
           (902, 4, 30, 'wechat', 'member-wechat', 'pending')`,
      );
      await db.query(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, detail_json, ip)
         VALUES (903, 4, 'test.sentinel', 'test', 'sentinel', '{"marker":"wp061-r2"}', '127.0.0.1')`,
      );
    } catch (error) {
      const cleanupErrors = await cleanupResources();
      if (cleanupErrors.length > 0) {
        throw new AggregateError([error, ...cleanupErrors], 'Integration setup and cleanup both failed.');
      }
      throw error;
    }
  });

  afterAll(async () => {
    const cleanupErrors = await cleanupResources();
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, 'Integration cleanup failed.');
    }
  });

  async function cleanupResources() {
    const cleanupErrors: unknown[] = [];
    if (upstreamStarted) {
      try {
        await upstream.close();
        upstreamStarted = false;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (databaseOpen) {
      try {
        await db.end();
        databaseOpen = false;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (lease) {
      try {
        const evidence = await lease.dispose();
        expect(evidence.containerInspectStatus).toBe(404);
        expect(evidence.volumeInspectStatus).toBe(404);
        console.log(
          `TC-INT-LEASE-001 container=${evidence.containerId} volume=${evidence.volumeName} containerInspectStatus=${evidence.containerInspectStatus} volumeInspectStatus=${evidence.volumeInspectStatus}`,
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    return cleanupErrors;
  }

  async function financialSnapshot() {
    const snapshot: Record<string, string> = {};
    for (const table of ['earnings', 'withdrawal_requests'] as const) {
      snapshot[table] = serializeRows(await rows<RowDataPacket>(`SELECT * FROM ${table} ORDER BY id`));
    }
    return snapshot;
  }

  async function expectFinancialSnapshotUnchanged(work: () => Promise<unknown>) {
    const before = await financialSnapshot();
    await work();
    expect(await financialSnapshot()).toEqual(before);
  }

  it('returns JWT, string IDs, and permissions after login', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe('1');

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${response.body.data.token}`);
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
    const created = await request(app).post('/api/v1/plans').set('Authorization', `Bearer ${memberToken}`).send(body);

    expect(created.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(200);
    expect(created.body.data.id).toMatch(/^\d+$/);
    createdPlanId = created.body.data.id;

    const duplicate = await request(app).post('/api/v1/plans').set('Authorization', `Bearer ${memberToken}`).send(body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe(40901);

    const list = await request(app).get('/api/v1/plans').set('Authorization', `Bearer ${memberToken}`);
    expect(list.body.data.list.every((item: Record<string, unknown>) => item.ownerId === '4')).toBe(true);
  });

  it('maps a concurrent keyword binding loser to 40901', async () => {
    const body = {
      taskId: 'task-race',
      channelId: 'channel-race',
      keyword: 'race-keyword',
      landingUrl: 'https://example.com/race',
      popularizeType: 0,
    };
    const call = () => request(app).post('/api/v1/plans').set('Authorization', `Bearer ${memberToken}`).send(body);

    const results = await Promise.all([call(), call()]);
    expect(results.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(results.find((item) => item.status === 409)?.body.code).toBe(40901);
  });

  it('persists exact plan ID and pushes a complete v2 composition payload', async () => {
    const planBody = {
      taskId: 'task-v2',
      channelId: 'channel-v2',
      keyword: 'v2-keyword',
      landingUrl: 'https://example.com/v2',
      popularizeType: 0,
    };
    const createdPlan = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${memberToken}`)
      .send(planBody);
    expect(createdPlan.status).toBe(201);

    let plan: ({ zhihu_plan_id: string | null; sync_status: string } & RowDataPacket) | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      [plan] = await rows<{ zhihu_plan_id: string | null; sync_status: string } & RowDataPacket>(
        'SELECT zhihu_plan_id, sync_status FROM plans WHERE id = ?',
        [createdPlan.body.data.id],
      );
      if (plan?.sync_status === 'synced') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(plan).toMatchObject({ zhihu_plan_id: '2071265453767405652', sync_status: 'synced' });

    const createdComposition = await request(app)
      .post('/api/v1/compositions')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        planId: createdPlan.body.data.id,
        mediaType: 1,
        mediaAccount: 'integration-account',
        compositionType: 1,
        compositionSubType: 1,
        promoUrl: 'https://example.com/composition',
        releaseTime: '2026-08-13T16:05:00+08:00',
      });
    expect(createdComposition.status).toBe(201);

    let composition: ({ zhihu_composition_id: string | null; sync_status: string } & RowDataPacket) | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      [composition] = await rows<{ zhihu_composition_id: string | null; sync_status: string } & RowDataPacket>(
        'SELECT zhihu_composition_id, sync_status FROM compositions WHERE id = ?',
        [createdComposition.body.data.id],
      );
      if (composition?.sync_status === 'synced') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(composition).toMatchObject({
      zhihu_composition_id: '2071266138193975100',
      sync_status: 'synced',
    });
    expect(receivedComposition).toMatchObject({
      plan_id: '2071265453767405652',
      channel_id: 'channel-v2',
      media_type: 'KOC抖音',
      media_account: 'integration-account',
      composition_type: 1,
      composition_sub_type: 1,
      composition_url: 'https://example.com/composition',
      release_time: 1786608300,
    });
    expect(receivedComposition).not.toHaveProperty('promo_url');
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
    const [member] = await rows<{ parent_id: string; role: string } & RowDataPacket>(
      'SELECT parent_id, role FROM users WHERE id = ?',
      [response.body.data.id],
    );
    expect(String(member.parent_id)).toBe('2');
    expect(member.role).toBe('creator');
    expect(response.body.data.temporaryPassword).toBeTruthy();
  });

  it('rejects creating another boss account through the subordinate API', async () => {
    const response = await request(app).post('/api/v1/team/members').set('Authorization', `Bearer ${bossToken}`).send({
      username: 'another-boss',
      displayName: 'Another Boss',
      role: 'admin',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe(42200);
  });

  it('overwrites metrics instead of accumulating repeated syncs', async () => {
    metricValue = 10;
    await syncMetrics({});
    metricValue = 12;
    await syncMetrics({});

    const [metric] = await rows<{ impressions: number } & RowDataPacket>(
      `SELECT impressions
       FROM daily_metrics
       WHERE channel_id = 'channel-a' AND keyword = 'test-keyword'`,
    );
    expect(Number(metric.impressions)).toBe(12);
  });

  it('TC-FIN-LEGACY-HTTP-001 blocks member create without changing financial tables', async () => {
    await expectFinancialSnapshotUnchanged(async () => {
      const response = await request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ amount: 20, payMethod: 'alipay', payAccount: 'new@example.com' });

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: 50310, data: null, message: gateMessage });
    });
    await expectFinancialSnapshotUnchanged(async () => {
      const response = await request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({ amount: 20, payMethod: 'wechat', payAccount: 'leader-wechat' });

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: 50310, data: null, message: gateMessage });
    });
  });

  it('TC-FIN-LEGACY-HTTP-002 blocks boss approve without changing financial tables', async () => {
    await expectFinancialSnapshotUnchanged(async () => {
      const response = await request(app)
        .post('/api/v1/withdrawals/901/approve')
        .set('Authorization', `Bearer ${bossToken}`);

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: 50310, data: null, message: gateMessage });
    });
  });

  it('TC-FIN-LEGACY-HTTP-003 blocks boss reject without changing financial tables', async () => {
    await expectFinancialSnapshotUnchanged(async () => {
      const response = await request(app)
        .post('/api/v1/withdrawals/902/reject')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ remark: 'not now' });

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: 50310, data: null, message: gateMessage });
    });
  });

  it('TC-FIN-LEGACY-SVC-001 blocks service create before any write', async () => {
    await expectFinancialSnapshotUnchanged(async () => {
      await expect(
        createWithdrawal(
          {
            sub: '4',
            jti: 'integration-member',
            role: 'creator',
            parentId: '2',
            username: 'member-a',
            displayName: 'Member A',
          },
          { amount: 20, payMethod: 'alipay', payAccount: 'new@example.com' },
        ),
      ).rejects.toMatchObject({ httpStatus: 503, code: 50310, message: gateMessage });
    });
  });

  it('TC-FIN-LEGACY-SVC-002 blocks service approve before any write', async () => {
    await expectFinancialSnapshotUnchanged(async () => {
      await expect(
        approveWithdrawal(
          {
            sub: '1',
            jti: 'integration-boss',
            role: 'admin',
            parentId: null,
            username: 'admin',
            displayName: 'Boss',
          },
          '901',
        ),
      ).rejects.toMatchObject({ httpStatus: 503, code: 50310, message: gateMessage });
    });
  });

  it('TC-FIN-LEGACY-SVC-003 blocks service reject before any write', async () => {
    await expectFinancialSnapshotUnchanged(async () => {
      await expect(
        rejectWithdrawal(
          {
            sub: '1',
            jti: 'integration-boss-reject',
            role: 'admin',
            parentId: null,
            username: 'admin',
            displayName: 'Boss',
          },
          '902',
          'not now',
        ),
      ).rejects.toMatchObject({ httpStatus: 503, code: 50310, message: gateMessage });
    });
  });

  it('TC-FIN-LEGACY-BYPASS-001 blocks malformed requests despite override-shaped inputs', async () => {
    const previousOverride = process.env.FINANCE_GATE_OVERRIDE;
    process.env.FINANCE_GATE_OVERRIDE = '1';
    try {
      await expectFinancialSnapshotUnchanged(async () => {
        const createResponse = await request(app)
          .post('/api/v1/withdrawals')
          .set('Authorization', `Bearer ${memberToken}`)
          .set('x-finance-gate', 'closed')
          .set('Cookie', 'finance_gate=closed')
          .send({ amount: 'not-a-number' });
        expect(createResponse.status).toBe(503);
        expect(createResponse.body.code).toBe(50310);
      });
      await expectFinancialSnapshotUnchanged(async () => {
        const approveResponse = await request(app)
          .post('/api/v1/withdrawals/not-an-id/approve')
          .set('Authorization', `Bearer ${bossToken}`)
          .set('x-finance-gate', 'closed');
        expect(approveResponse.status).toBe(503);
        expect(approveResponse.body.code).toBe(50310);
      });
      await expectFinancialSnapshotUnchanged(async () => {
        const rejectResponse = await request(app)
          .post('/api/v1/withdrawals/902/reject')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({ remark: '' });
        expect(rejectResponse.status).toBe(503);
        expect(rejectResponse.body.code).toBe(50310);
      });
    } finally {
      if (previousOverride === undefined) delete process.env.FINANCE_GATE_OVERRIDE;
      else process.env.FINANCE_GATE_OVERRIDE = previousOverride;
    }
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

    const [rule] = await rows<{ status: string } & RowDataPacket>('SELECT status FROM callback_rules WHERE id = ?', [
      created.body.data.id,
    ]);
    expect(rule.status).toBe('inactive');
  });

  it('returns only a masked callback secret and stores only ciphertext', async () => {
    const response = await request(app)
      .post('/api/v1/callbacks/secret/rotate')
      .set('Authorization', `Bearer ${bossToken}`);

    expect(response.body.data.signKey).toMatch(/^sk_live_\*{4}[a-f0-9]{4}$/);
    const [secret] = await rows<{ secret_ciphertext: string } & RowDataPacket>(
      'SELECT secret_ciphertext FROM callback_secrets WHERE project_id = 1',
    );
    expect(secret.secret_ciphertext).not.toContain('sk_live_');
  });
});
