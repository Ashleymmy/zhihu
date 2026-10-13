import { MySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { ModuleManifest } from '../../src/core/contracts';

async function main() {
  if (process.env.WITHDRAWAL_UI_TEST !== '1') throw new Error('Only disposable withdrawal UI tests');
  const container = await new MySqlContainer('mysql:8.0')
    .withDatabase('withdrawal_ui_test')
    .withUsername('test')
    .withUserPassword('isolated')
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
    OPC_MODULES: '',
    QUEUE_DRIVER: 'memory',
    JWT_SECRET: 'isolated_withdrawal_ui_secret_32_characters',
    DEV_DEMO_AUTH: '0',
    OPC_WITHDRAWAL_POLICY_ENABLED: '1',
    LOG_LEVEL: 'silent',
  });
  await runOpcMigrations(target, []);
  const c = await mysql.createConnection(target),
    hash = await bcrypt.hash('Review123456', 4);
  await c.query(
    "INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,parent_id,must_change_pwd) VALUES(1,'review_finance',?,'admin','finance','财务验收',NULL,0),(2,'leader_wang',?,'leader','all','团长验收',NULL,0),(3,'creator_li',?,'creator','all','达人验收',2,0),(4,'review_ops',?,'admin','operations','运营验收',NULL,0),(5,'creator_chen',?,'creator','all','独立达人验收',NULL,0)",
    [hash, hash, hash, hash, hash],
  );
  await c.query("INSERT INTO projects(id,name,slug) VALUES(1,'隔离提现项目','withdrawal-test')");
  await c.query("INSERT INTO module_installations(module_id,version) VALUES('withdrawal-test','1')");
  await c.query(
    "INSERT INTO integration_accounts(id,module_id,account_key,name,created_by) VALUES(1,'withdrawal-test','synthetic','隔离验收',1)",
  );
  await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1)');
  await c.query('INSERT INTO project_members(project_id,user_id) VALUES(1,2),(1,3),(1,5)');
  const manifest: ModuleManifest = {
    id: 'withdrawal-test',
    name: '隔离提现项目',
    version: '1',
    contractVersion: 2,
    roles: ['admin', 'leader', 'creator'],
    permissions: {},
    capabilities: [],
    entryPath: '/tasks',
  };
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { createCoreApp } = await import('../../src/core/app'),
    { mountStatic } = await import('../../src/composition/static');
  const runtime = new ModuleRuntime([manifest]);
  runtime.register({ manifest, router: Router() });
  const app = createCoreApp(runtime, mountStatic);
  app.locals.moduleRuntime = runtime;
  const server = app.listen(0, '127.0.0.1', () =>
    process.send?.({ port: (server.address() as { port: number }).port, importRecoveryDb: target }),
  );
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeAllConnections();
    const { db } = await import('../../src/db'),
      { closeRateLimiter } = await import('../../src/utils/rateLimit'),
      { revocationStore } = await import('../../src/auth/revocation');
    await Promise.all([db.end(), c.end(), closeRateLimiter(), revocationStore.close()]);
    await container.stop({ remove: true, removeVolumes: true });
    process.disconnect?.();
  }
  process.on('message', (m) => {
    if (m === 'stop') void stop();
  });
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
