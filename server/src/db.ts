import mysql, { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { config } from './config';

export const db = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+08:00',
  supportBigNumbers: true,
  bigNumberStrings: true,
  decimalNumbers: true,
  multipleStatements: false,
});

export async function rows<T extends RowDataPacket>(sql: string, bindings: unknown[] = []): Promise<T[]> {
  const [result] = await db.query<T[]>(sql, bindings);
  return result;
}

export async function withTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
