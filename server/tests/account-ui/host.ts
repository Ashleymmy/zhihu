// Isolated browser acceptance host. Never contacts the production SMS provider.
import { MySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { runOpcMigrations } from '../../scripts/opcMigrations';
async function main() {
  if (process.env.ACCOUNT_UI_TEST !== '1') throw new Error('Isolated UI test only');
  const container = await new MySqlContainer('mysql:8.0')
    .withDatabase('account_ui')
    .withUsername('test')
    .withUserPassword('isolated_account_ui')
    .start();
  const target = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getUserPassword(),
  };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    OPC_MODULES: '',
    QUEUE_DRIVER: 'memory',
    DEV_DEMO_AUTH: '0',
    LOG_LEVEL: 'silent',
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    JWT_SECRET: 'isolated_account_ui_jwt_secret_long_enough',
    SMS_REGISTRATION_ENABLED: '1',
    SMS_LOGIN_ENABLED: '1',
    SMS_SIGN_NAME: '测试',
    SMS_TEMPLATE_CODE: 'SMS_123456',
    SMS_DAILY_LIMIT: '100',
    SMS_VERIFICATION_SECRET: 'isolated_account_ui_sms_secret_long_enough',
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'isolated_test_id',
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'isolated_test_secret',
  });
  const network = setupServer(
    http.post('https://dysmsapi.aliyuncs.com/', async ({ request }) => {
      const body = new URLSearchParams(new URL(request.url).search);
      for (const [key, value] of new URLSearchParams(await request.text())) body.set(key, value);
      process.send?.({
        sms: { phone: body.get('PhoneNumbers'), code: JSON.parse(body.get('TemplateParam') || '{}').code },
      });
      return HttpResponse.json({ Code: 'OK', Message: 'OK', RequestId: 'isolated' });
    }),
  );
  network.listen({
    onUnhandledRequest(req) {
      if (!new URL(req.url).hostname.match(/^(127\.0\.0\.1|localhost)$/))
        throw new Error('Unexpected external request');
    },
  });
  await runOpcMigrations(target, []);
  const c = await mysql.createConnection(target),
    hash = await bcrypt.hash('Legacy_password_more_than16!', 4);
  for (const [i, role] of ['creator', 'leader', 'admin'].entries())
    await c.query(
      'INSERT INTO users(id,username,password_hash,role,role_id,display_name,must_change_pwd) VALUES(?,?,?,?,(SELECT id FROM roles WHERE role_key=?),?,0)',
      [i + 1, role, hash, role, role, '验收' + role],
    );
  const { createApp } = await import('../../src/app'),
    app = createApp();
  const server = app.listen(0, '127.0.0.1', () =>
    process.send?.({ port: (server.address() as { port: number }).port }),
  );
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    server.close();
    server.closeAllConnections();
    await (await import('../../src/db')).db.end();
    await c.end();
    network.close();
    await container.stop({ remove: true, removeVolumes: true });
    process.disconnect?.();
  }
  process.on('message', (m) => {
    if (m === 'stop') void stop();
    if (m === 'reset-limits')
      void c
        .query('DELETE FROM sms_registration_limits')
        .then(() => c.query('DELETE FROM sms_registration_challenges'))
        .then(() => process.send?.({ reset: true }));
  });
  process.on('SIGTERM', () => void stop());
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
