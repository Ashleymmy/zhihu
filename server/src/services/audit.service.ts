import { PoolConnection } from 'mysql2/promise';
import { db } from '../db';

export interface AuditInput {
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  detail?: unknown;
  ip?: string | null;
}

export async function writeAudit(input: AuditInput, connection: PoolConnection | typeof db = db) {
  await connection.query(
    `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, detail_json, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      JSON.stringify(input.detail ?? null),
      input.ip ?? null,
    ],
  );
}
