import assert from 'node:assert/strict';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { createApp } from '../../src/app';
import { signToken } from '../../src/auth/jwt';
import { db } from '../../src/db';

const upstream = setupServer();

async function main() {
  upstream.listen({
    onUnhandledRequest(networkRequest, print) {
      if (new URL(networkRequest.url).hostname !== '127.0.0.1') print.error();
    },
  });
  const app = createApp();

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

  await db.query(
    `INSERT INTO users
      (id, username, password_hash, role, parent_id, display_name, is_active, must_change_pwd)
     VALUES
      (1, 'boss', 'unused', 'boss', NULL, 'Boss', 1, 0),
      (2, 'leader-a', 'unused', 'leader', 1, 'Leader A', 1, 0),
      (3, 'leader-b', 'unused', 'leader', 1, 'Leader B', 1, 0),
      (4, 'member-a', 'unused', 'member', 2, 'Member A', 1, 0),
      (5, 'member-b', 'unused', 'member', 3, 'Member B', 1, 0)`,
  );
  await db.query(
    `INSERT INTO plans
      (id, project_id, zhihu_task_id, channel_id, keyword, landing_url,
       popularize_type, owner_id, created_by, status, sync_status)
     VALUES
      (101, 1, 'task-a', 'channel-a', 'keyword-a', 'https://example.com/a', 0, 4, 4, 'active', 'synced'),
      (102, 1, 'task-b', 'channel-b', 'keyword-b', 'https://example.com/b', 0, 5, 5, 'active', 'synced')`,
  );
  await db.query(
    `INSERT INTO compositions
      (id, plan_id, owner_id, media_type, media_account, composition_type,
       composition_sub_type, promo_url, status, sync_status)
     VALUES
      (201, 101, 4, 1, 'account-a', 1, 1, 'https://example.com/content-a', 'active', 'synced'),
      (202, 102, 5, 1, 'account-b', 1, 1, 'https://example.com/content-b', 'active', 'synced')`,
  );
  await db.query(
    `INSERT INTO daily_metrics
      (project_id, channel_id, keyword, plan_id, owner_id, stat_date,
       impressions, clicks, conversions, earning, fetched_at)
     VALUES
      (1, 'channel-a', 'keyword-a', 101, 4, '2026-08-05', 100, 10, 2, 10, NOW()),
      (1, 'channel-b', 'keyword-b', 102, 5, '2026-08-05', 200, 20, 4, 20, NOW())`,
  );
  await db.query(
    `INSERT INTO earnings (id, user_id, project_id, plan_id, settle_date, amount, status)
     VALUES
      (301, 4, 1, 101, '2026-08-05', 10, 'confirmed'),
      (302, 5, 1, 102, '2026-08-05', 20, 'confirmed')`,
  );
  await db.query(
    `INSERT INTO withdrawal_requests
      (id, user_id, amount, pay_method, pay_account, status)
     VALUES
      (401, 4, 5, 'alipay', 'member-a@example.com', 'pending'),
      (402, 5, 6, 'alipay', 'member-b@example.com', 'pending')`,
  );
  await db.query(
    `INSERT INTO channels
      (id, project_id, zhihu_channel_id, generation, name, owner_id, synced_at)
     VALUES
      (301, 1, 'channel-a', 1, 'Channel A', 4, NOW()),
      (302, 1, 'channel-b', 1, 'Channel B', 5, NOW())`,
  );
  await db.query(
    `INSERT INTO callback_rules
      (id, project_id, plan_id, owner_id, callback_url, events_json, status, created_by)
     VALUES
      (501, 1, 101, 4, 'https://callback.example.com/a', JSON_ARRAY('conversion'), 'active', 1),
      (502, 1, 102, 5, 'https://callback.example.com/b', JSON_ARRAY('conversion'), 'active', 1)`,
  );
  await db.query(
    `INSERT INTO callback_logs
      (id, rule_id, owner_id, event, status)
     VALUES
      (601, 501, 4, 'conversion', 'success'),
      (602, 502, 5, 'conversion', 'success')`,
  );

  const leaderToken = await signToken({
    id: '2',
    role: 'leader',
    parentId: '1',
    username: 'leader-a',
    displayName: 'Leader A',
  });
  const bossToken = await signToken({
    id: '1',
    role: 'boss',
    parentId: null,
    username: 'boss',
    displayName: 'Boss',
  });
  const leader = (method: 'get' | 'patch' | 'delete', path: string) =>
    request(app)[method](path).set('Authorization', `Bearer ${leaderToken}`);
  const boss = (path: string) => request(app).get(path).set('Authorization', `Bearer ${bossToken}`);

  const plans = await leader('get', '/api/v1/plans');
  assert.equal(plans.status, 200);
  assert.deepEqual(plans.body.data.list.map((item: { ownerId: string }) => item.ownerId), ['4']);
  assert.equal((await leader('get', '/api/v1/plans/102')).status, 404);
  assert.equal((await leader('patch', '/api/v1/plans/102').send({ name: 'forbidden' })).status, 404);
  assert.equal((await leader('delete', '/api/v1/plans/102')).status, 404);

  const overview = await leader('get', '/api/v1/metrics/overview');
  assert.equal(overview.body.data.total.impressions, 100);
  const byMember = await leader('get', '/api/v1/metrics/by-member?from=2026-08-01&to=2026-08-06');
  assert.deepEqual(byMember.body.data.map((item: { ownerId: string }) => item.ownerId), ['4']);

  const team = await leader('get', '/api/v1/team/members');
  assert.equal(team.body.data.some((item: { id: string }) => item.id === '5'), false);
  assert.equal((await leader('patch', '/api/v1/team/members/5').send({ displayName: 'forbidden' })).status, 403);

  const compositions = await leader('get', '/api/v1/compositions');
  assert.deepEqual(compositions.body.data.list.map((item: { ownerId: string }) => item.ownerId), ['4']);
  assert.equal((await leader('get', '/api/v1/compositions/202/audit-status')).status, 404);
  assert.equal((await leader('patch', '/api/v1/compositions/202').send({ title: 'forbidden' })).status, 404);

  const earnings = await leader('get', '/api/v1/earnings');
  assert.equal(earnings.body.data.total, 1);
  assert.equal(earnings.body.data.list[0].amount, 10);
  const earningSummary = await leader('get', '/api/v1/earnings/summary');
  assert.equal(earningSummary.body.data.confirmed, 10);

  const withdrawals = await leader('get', '/api/v1/withdrawals');
  assert.equal(withdrawals.body.data.total, 1);
  assert.equal(withdrawals.body.data.list[0].userId, '4');
  assert.equal(
    (await request(app)
      .post('/api/v1/withdrawals/402/approve')
      .set('Authorization', `Bearer ${leaderToken}`)).status,
    403,
  );

  const channels = await leader('get', '/api/v1/channels');
  assert.deepEqual(channels.body.data.list.map((item: { ownerId: string }) => item.ownerId), ['4']);
  const rules = await leader('get', '/api/v1/callbacks/rules');
  assert.deepEqual(rules.body.data.list.map((item: { ownerId: string }) => item.ownerId), ['4']);
  const logs = await leader('get', '/api/v1/callbacks/logs');
  assert.deepEqual(logs.body.data.list.map((item: { ownerId: string }) => item.ownerId), ['4']);

  assert.equal((await boss('/api/v1/plans')).body.data.total, 2);
  assert.equal((await boss('/api/v1/compositions')).body.data.total, 2);
  assert.equal((await boss('/api/v1/earnings')).body.data.total, 2);
  assert.equal((await boss('/api/v1/withdrawals')).body.data.total, 2);
  assert.equal((await boss('/api/v1/channels')).body.data.total, 2);
  assert.equal((await boss('/api/v1/callbacks/rules')).body.data.total, 2);
  assert.equal((await boss('/api/v1/callbacks/logs')).body.data.total, 2);

  console.log('scope_acceptance_ok modules=8 cross_team_mutations=5');
}

void main()
  .finally(async () => {
    upstream.close();
    await db.end();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
