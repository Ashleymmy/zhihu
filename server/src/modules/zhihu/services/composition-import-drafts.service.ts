import { createHash } from 'node:crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { rows, withTransaction } from '../../../db';
import { AppError } from '../../../middleware/errors';
import type { AuthUser } from '../../../types';
import { scopeFilter } from '../../../utils/scopeFilter';
import { writeAudit } from '../../../services/audit.service';
import { analyzeCompositionImport } from './composition-import.service';
import { compositionUrlKey, type ImportOptions } from './composition-import-parser';

interface DraftRow extends RowDataPacket {
  id: string; owner_id: string; file_name: string; sheet_name: string;
  total_count: number; pending_count: number; duplicate_count: number; ready_count: number;
  options_json: ImportOptions | string;
  preview_json: Awaited<ReturnType<typeof analyzeCompositionImport>> | string;
  source_file: Buffer;
}
const json = <T>(value: T | string): T => typeof value === 'string' ? JSON.parse(value) : value;

export async function saveWorkImportDraft(user: AuthUser, file: { originalname: string; buffer: Buffer }, options: ImportOptions, ip?: string) {
  const preview = await analyzeCompositionImport(user, file, options);
  if (!preview.total) throw new AppError(422, 42200, '当前工作表没有作品数据');
  // Keep the most complete row for each link even when a local plan does not exist yet.
  const chosen = new Map<string, typeof preview.rows[number]>();
  for (const row of preview.rows) {
    if (row.status === 'duplicate') continue;
    const key = compositionUrlKey(row.promoUrl);
    if (!key) continue;
    const previous = chosen.get(key);
    if (!previous) { chosen.set(key, row); continue; }
    const keep = row.errors.length < previous.errors.length ? row : previous;
    const duplicate = keep === row ? previous : row;
    duplicate.status = 'duplicate';
    duplicate.notes.push(`与本表第 ${keep.row} 行链接相同，本地批次只保留一条待推送记录`);
    chosen.set(key, keep);
  }
  preview.ready = preview.rows.filter(row => row.status === 'ready').length;
  preview.duplicate = preview.rows.filter(row => row.status === 'duplicate').length;
  preview.invalid = preview.rows.filter(row => row.status === 'invalid').length;
  const sanitized = { ...preview, rows: preview.rows.map(({ input: _, ...row }) => row) };
  const sourceKey = createHash('sha256').update(file.buffer).update('\0').update(preview.sheetName).digest('hex');
  const pending = preview.total - preview.duplicate;
  const id = await withTransaction(async connection => {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO composition_import_drafts
       (owner_id,source_key,file_name,sheet_name,source_file,options_json,preview_json,total_count,pending_count,duplicate_count,ready_count)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),options_json=VALUES(options_json),preview_json=VALUES(preview_json),
         pending_count=VALUES(pending_count),duplicate_count=VALUES(duplicate_count),ready_count=VALUES(ready_count),updated_at=CURRENT_TIMESTAMP`,
      [user.sub, sourceKey, file.originalname.slice(0, 255), preview.sheetName, file.buffer, JSON.stringify(options), JSON.stringify(sanitized), preview.total, pending, preview.duplicate, preview.ready],
    );
    const value = String(result.insertId);
    await writeAudit({ userId: user.sub, action: 'composition.import_draft', resourceType: 'composition_import_draft', resourceId: value, detail: { total: preview.total, pending, duplicate: preview.duplicate, delivery: 'local_only' }, ip }, connection);
    return value;
  });
  return { id, total: preview.total, pending, duplicate: preview.duplicate, ready: preview.ready, delivery: 'local_only' as const, preview: sanitized };
}

export async function listWorkImportDrafts(user: AuthUser, page = 1) {
  const scope = scopeFilter(user, 'owner_id');
  const list = await rows<DraftRow>(`SELECT id,file_name,sheet_name,total_count,pending_count,duplicate_count,ready_count,created_at,updated_at FROM composition_import_drafts WHERE ${scope.clause} ORDER BY updated_at DESC,id DESC LIMIT 20 OFFSET ?`, [...scope.bindings, (page - 1) * 20]);
  const [count] = await rows<RowDataPacket>(`SELECT COUNT(*) total FROM composition_import_drafts WHERE ${scope.clause}`, scope.bindings);
  return { list, total: Number(count.total), page, pageSize: 20 };
}

export async function getWorkImportDraft(user: AuthUser, id: string, includeFile = false) {
  const scope = scopeFilter(user, 'owner_id');
  const [draft] = await rows<DraftRow>(`SELECT id,file_name,sheet_name,options_json,preview_json,total_count,pending_count,duplicate_count,ready_count,created_at,updated_at${includeFile ? ',source_file' : ''} FROM composition_import_drafts WHERE id=? AND ${scope.clause} LIMIT 1`, [id, ...scope.bindings]);
  if (!draft) throw new AppError(404, 40401, '找不到本地待推送批次');
  return { ...draft, options: json<ImportOptions>(draft.options_json), preview: json<Awaited<ReturnType<typeof analyzeCompositionImport>>>(draft.preview_json), options_json: undefined, preview_json: undefined };
}
