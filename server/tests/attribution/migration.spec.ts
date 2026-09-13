import { it, expect } from 'vitest';
import { MySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import { mkdtemp, cp, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runOpcMigrations } from '../../scripts/opcMigrations';
it('0022c82 模块库增量升级、重复迁移保留旧 ID 和金额，回退无需删表', async () => {
  const container = await new MySqlContainer('mysql:8.0')
    .withDatabase('attribution_upgrade_test')
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
  const schema = await mkdtemp(path.join(tmpdir(), 'zh-schema-baseline-'));
  await cp(path.resolve('schema'), schema, { recursive: true });
  // 仅移除临时副本里的新迁移，重现 0022c82 的模块 schema。
  for (const file of await readdir(path.join(schema, 'zhihu')))
    if (/^0(18|19|2[0-9])_/.test(file)) await unlink(path.join(schema, 'zhihu', file));
  let c: mysql.Connection | undefined;
  try {
    await runOpcMigrations(target, ['zhihu'], schema);
    c = await mysql.createConnection(target);
    await c.query(
      "INSERT INTO users(id,username,password_hash,role,display_name) VALUES(901,'history','unused','creator','历史用户')",
    );
    await c.query(
      "INSERT INTO earnings(id,user_id,project_id,settle_date,amount,status,source_ref) VALUES(7001,901,1,'2025-01-01',12345,'confirmed','history:7001')",
    );
    const snapshot = async () => {
      const [r] = await c!.query(
        'SELECT CAST(id AS CHAR) id,CAST(user_id AS CHAR) user_id,CAST(project_id AS CHAR) project_id,CAST(amount AS CHAR) amount,status,source_ref FROM earnings ORDER BY id',
      );
      return r;
    };
    const before = await snapshot();
    await runOpcMigrations(target, ['zhihu']);
    await runOpcMigrations(target, ['zhihu']);
    expect(await snapshot()).toEqual(before);
    const [newTables] = await c.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('zh_keywords','zh_statement_entries','zh_engine_routes')",
    );
    expect(Number(newTables[0].n)).toBe(3);
    await runOpcMigrations(target, []);
    expect(await snapshot()).toEqual(before);
    const [original] = await c.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM schema_migrations WHERE name IN ('015_data_import.sql','016_data_import_workflow.sql','017_attribution_core.sql')",
    );
    expect(Number(original[0].n)).toBe(3);
  } finally {
    await c?.end();
    await container.stop({ remove: true, removeVolumes: true });
  }
}, 90000);
