import fs from 'node:fs';
import path from 'node:path';

/**
 * 生产迁移文件清单（按文件名排序，与 migrationRunner 的执行顺序一致）。
 * 从目录动态读取——新增迁移不需要同步修改任何测试。
 */
export function productionMigrations(migrationsDirectory = path.resolve(process.cwd(), 'migrations')): string[] {
  return fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}
