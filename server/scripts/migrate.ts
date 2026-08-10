import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config';

async function main() {
  const connection = await mysql.createConnection({ ...config.db, multipleStatements: false });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const dir = path.resolve(process.cwd(), 'migrations');
    const files = (await fs.readdir(dir))
      .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith('.down.sql'))
      .sort();
    for (const name of files) {
      const [existing] = await connection.query<mysql.RowDataPacket[]>('SELECT name FROM schema_migrations WHERE name = ?', [name]);
      if (existing.length) continue;
      const sql = await fs.readFile(path.join(dir, name), 'utf8');
      const statements = sql.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean);
      await connection.beginTransaction();
      try {
        for (const statement of statements) await connection.query(statement);
        await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
        await connection.commit();
        console.log(`applied ${name}`);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } finally {
    await connection.end();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
