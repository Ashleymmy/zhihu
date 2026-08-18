import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

export interface MigrationTarget {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const migrationFilePattern = /^\d+_.+\.sql$/;

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function migrationNames(migrationsDirectory: string): Promise<string[]> {
  return (await fs.readdir(migrationsDirectory))
    .filter((name) => migrationFilePattern.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

async function rollbackAfterFailure(connection: mysql.Connection, primaryError: unknown): Promise<never> {
  try {
    await connection.rollback();
  } catch (rollbackError) {
    throw new AggregateError([primaryError, rollbackError], 'Migration and rollback both failed');
  }

  throw primaryError;
}

export async function runMigrations(target: MigrationTarget, migrationsDirectory: string): Promise<MigrationResult> {
  const connection = await mysql.createConnection({ ...target, multipleStatements: false });

  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const result: MigrationResult = { applied: [], skipped: [] };
    for (const name of await migrationNames(migrationsDirectory)) {
      const [existing] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT name FROM schema_migrations WHERE name = ?',
        [name],
      );
      if (existing.length) {
        result.skipped.push(name);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDirectory, name), 'utf8');
      await connection.beginTransaction();
      try {
        for (const statement of splitStatements(sql)) await connection.query(statement);
        await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
        await connection.commit();
        result.applied.push(name);
      } catch (error) {
        await rollbackAfterFailure(connection, error);
      }
    }

    return result;
  } finally {
    await connection.end();
  }
}
