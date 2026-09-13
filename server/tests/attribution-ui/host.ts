import { MySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
async function main() {
  if (process.env.ATTRIBUTION_UI_TEST !== '1') throw Error('仅允许隔离浏览器测试');
  const container = await new MySqlContainer('mysql:8.0')
    .withDatabase('attribution_ui_test')
    .withUsername('test')
    .withUserPassword('isolated_test')
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
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    OPC_MODULES: 'zhihu',
    QUEUE_DRIVER: 'memory',
    JWT_SECRET: 'attribution_ui_test_secret_32_characters',
    LOG_LEVEL: 'silent',
    ZHIHU_API_BASE: 'https://open.zhihu.com',
    ZHIHU_ACCESS_TOKEN: 'mock_access_token',
    ZHIHU_SECRET_KEY: 'mock_secret_key',
    DEV_DEMO_AUTH: '0',
  });
  const network = setupServer(
    http.all('https://open.zhihu.com/*', () =>
      HttpResponse.json({ error: { message: '测试禁止真实上游请求' } }, { status: 503 }),
    ),
  );
  network.listen({ onUnhandledRequest: 'error' });
  await runOpcMigrations(target, ['zhihu']);
  const c = await mysql.createConnection(target);
  const hash = await bcrypt.hash('isolated_password', 4);
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,display_name,parent_id) VALUES(1,'admin',?,'admin','管理员',NULL),(2,'leader',?,'leader','团长',NULL),(3,'creator',?,'creator','达人',2)",
    [hash, hash, hash],
  );
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3)');
  await c.query(
    "INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'ui-channel',1,'测试渠道')",
  );
  await c.query("INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'ui-task','测试任务',NOW())");
  const { createApp } = await import('../../src/app'),
    { db } = await import('../../src/db'),
    { registerJob, closeQueue } = await import('../../src/queue');
  const app = createApp();
  // 模拟创建成功的上游结果，其余数据库、权限、业务接口及页面均使用实际实现。
  registerJob('zhihu.push-plan', async (data) => {
    await db.query(
      "UPDATE plans SET sync_status='synced',status='active',zhihu_plan_id=CONCAT('mock-',id) WHERE id=?",
      [data.planId],
    );
  });
  const demo = process.env.ATTRIBUTION_DEMO_OUT
    ? await (await import('./demo-seed')).seedAttributionDemo(process.env.ATTRIBUTION_DEMO_OUT)
    : undefined;
  const server = app.listen(0, '127.0.0.1', () =>
    process.send?.({ port: (server.address() as { port: number }).port, demo }),
  );
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeAllConnections();
    app.locals.moduleRuntime.stop();
    const { closeRateLimiter } = await import('../../src/utils/rateLimit');
    const { revocationStore } = await import('../../src/auth/revocation');
    await Promise.all([db.end(), c.end(), closeQueue(), closeRateLimiter(), revocationStore.close()]);
    network.close();
    await container.stop({ remove: true, removeVolumes: true });
    process.disconnect?.();
  }
  process.on('message', (message) => { if (message === 'stop') void stop(); });
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
