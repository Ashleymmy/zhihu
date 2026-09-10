import path from 'node:path';
import mysql from 'mysql2/promise';
import { runMigrations, type MigrationTarget } from './migrationRunner';
export async function runOpcMigrations(
  target: MigrationTarget,
  enabledModules: string[],
  schemaRoot = path.resolve(process.cwd(), 'schema'),
) {
  const conn = await mysql.createConnection(target);
  try {
    const [found] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='users'",
    );
    if (!found.length) await runMigrations(target, path.join(schemaRoot, 'core'));
    else {
      const [baseline] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='schema_migrations'",
      );
      if (!baseline.length) throw new Error('旧库缺少迁移记录，停止自动升级');
      const [core] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT name FROM schema_migrations WHERE name='001_core_base.sql'",
      );
      if (!core.length) await runMigrations(target, path.join(schemaRoot, 'legacy-core'));
    }
    await runMigrations(target, path.join(schemaRoot, 'extensions'));
    const [columns] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='projects'",
    );
    const names = new Set(columns.map((r) => r.COLUMN_NAME));
    if (names.has('api_base_url')) await conn.query('ALTER TABLE projects MODIFY api_base_url VARCHAR(255) NULL');
    if (names.has('sign_method'))
      await conn.query("ALTER TABLE projects MODIFY sign_method ENUM('hmac_sha256','oauth2') NULL");
    for (const moduleId of enabledModules) {
      if (moduleId !== 'zhihu') throw new Error('未知模块安装目录: ' + moduleId);
      if (!names.has('api_base_url'))
        await conn.query('ALTER TABLE projects ADD COLUMN api_base_url VARCHAR(255) NULL');
      if (!names.has('sign_method'))
        await conn.query("ALTER TABLE projects ADD COLUMN sign_method ENUM('hmac_sha256','oauth2') NULL");
      if (!names.has('config_json')) await conn.query('ALTER TABLE projects ADD COLUMN config_json JSON NULL');
      const [uid] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name='zhihu_uid'",
      );
      if (!uid.length) await conn.query('ALTER TABLE users ADD COLUMN zhihu_uid VARCHAR(64) NULL');
      await runMigrations(target, path.join(schemaRoot, moduleId));
      await conn.query(
        "INSERT INTO module_installations(module_id,version) VALUES ('zhihu','1.0.0') ON DUPLICATE KEY UPDATE version=VALUES(version)",
      );
      await conn.query(
        "INSERT INTO integration_accounts(module_id,account_key,name) VALUES ('zhihu','legacy','知乎历史接入') ON DUPLICATE KEY UPDATE account_key=VALUES(account_key)",
      );
      await conn.query(
        "INSERT INTO projects(name,slug,api_base_url,sign_method) VALUES ('知乎历史业务','zhihu','https://open.zhihu.com','hmac_sha256') ON DUPLICATE KEY UPDATE slug=VALUES(slug)",
      );
      await conn.query(
        "INSERT INTO project_integrations(project_id,account_id) SELECT p.id,a.id FROM projects p CROSS JOIN integration_accounts a WHERE a.module_id='zhihu' AND a.account_key='legacy' AND (p.slug='zhihu' OR EXISTS(SELECT 1 FROM plans pl WHERE pl.project_id=p.id) OR EXISTS(SELECT 1 FROM channels ch WHERE ch.project_id=p.id) OR EXISTS(SELECT 1 FROM tasks t WHERE t.project_id=p.id) OR EXISTS(SELECT 1 FROM daily_metrics dm WHERE dm.project_id=p.id) OR EXISTS(SELECT 1 FROM earnings e WHERE e.project_id=p.id)) ON DUPLICATE KEY UPDATE account_id=VALUES(account_id)",
      );
      await conn.query(
        'CREATE TABLE IF NOT EXISTS zhihu_account_settings (project_id BIGINT PRIMARY KEY,account_id BIGINT NOT NULL,api_base_url VARCHAR(255),sign_method VARCHAR(32),config_json JSON) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      );
      await conn.query(
        "INSERT IGNORE INTO zhihu_account_settings(project_id,account_id,api_base_url,sign_method,config_json) SELECT p.id,pi.account_id,p.api_base_url,p.sign_method,p.config_json FROM projects p JOIN project_integrations pi ON pi.project_id=p.id JOIN integration_accounts a ON a.id=pi.account_id WHERE a.module_id='zhihu' AND a.account_key='legacy'",
      );
    }
  } finally {
    await conn.end();
  }
}
