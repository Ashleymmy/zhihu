import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import express from 'express';
import request from 'supertest';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import type { AuthUser } from '../../src/types';
import { importOptionsSchema } from '../../src/modules/zhihu/services/composition-import-parser';
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn(async () => ({ id: 'test' })) }));
vi.mock('../../src/auth/middleware', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { sub: '1', role: 'admin' }; next(); } }));
let container: StartedMySqlContainer, c: Connection, pool: typeof import('../../src/db').db;
let service: typeof import('../../src/modules/zhihu/services/composition-import.service');
const user = { sub: '1', role: 'admin', username: 'admin', displayName: '管理员', parentId: null, jti: 'import-test' } as AuthUser;
const options = importOptionsSchema.parse({ categoryMode: 'rotate-video' });
const headers = ['日期', '平台id', '微信/qq', '平台', '视频链接', '关键词'];
function file(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), '9月21日');
  return { originalname: '达人记录.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer };
}
function row(url: string, keyword = '可用计划') { return [46286, '000123', '联系人', '快手', url, keyword]; }
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').withDatabase('composition_import_test').withUsername('test').withUserPassword('isolated_test').start();
  const target = { host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getUserPassword() };
  Object.assign(process.env, { DB_HOST: target.host, DB_PORT: String(target.port), DB_NAME: target.database, DB_USER: target.user, DB_PASS: target.password, OPC_MODULES: 'zhihu', DEV_DEMO_AUTH: '0' });
  await runOpcMigrations(target, ['zhihu']);
  c = await mysql.createConnection(target);
  await c.query("INSERT INTO users(id,username,password_hash,role,display_name) VALUES(1,'admin','unused','admin','管理员'),(2,'creator','unused','creator','达人')");
  await c.query("INSERT INTO plans(id,project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by) VALUES(901,1,'task','channel','可用计划','https://example.com',0,1,1),(902,1,'task','channel','别人的计划','https://example.com',0,2,1)");
  pool = (await import('../../src/db')).db;
  service = await import('../../src/modules/zhihu/services/composition-import.service');
}, 90000);
afterAll(async () => { if (pool) await pool.end(); if (c) await c.end(); if (container) await container.stop({ remove: true, removeVolumes: true }); });

describe('真实数据库批量导入', () => {
  it('原始 Excel 经 multipart 上传、分析、落库、审计与队列，再次导入新增为零', async () => {
    const { compositionsRouter } = await import('../../src/modules/zhihu/routes/compositions');
    const { errorHandler } = await import('../../src/middleware/errors');
    const app = express().use('/compositions', compositionsRouter).use(errorHandler);
    const upload = file([row('https://v.kuaishou.com/ImportA/'), row(' https://v.kuaishou.com/ImportA '), row('https://v.kuaishou.com/ImportB'), row('https://v.kuaishou.com/NeedsKeyword', ''), [46286, 'abc', '', '抖音', 'https://xhslink.cn/o/Mismatch', '可用计划']]);
    const call = (path: string) => request(app).post(`/compositions/import/${path}`).field('options', JSON.stringify(options)).attach('file', upload.buffer, { filename: upload.originalname });
    const preview = await call('analyze');
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data).toMatchObject({ total: 5, ready: 2, duplicate: 1, invalid: 2 });
    const first = await call('commit');
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ created: 2, duplicate: 1, invalid: 2, queued: 2, queueFailed: [] });
    const [saved] = await c.query<RowDataPacket[]>('SELECT * FROM compositions ORDER BY id');
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ media_account: '000123', media_type: 'KOC快手', composition_type: 2 });
    const [audit] = await c.query<RowDataPacket[]>("SELECT * FROM audit_logs WHERE action='composition.batch_create'");
    expect(audit).toHaveLength(1);
    const second = await call('commit');
    expect(second.body.data).toMatchObject({ created: 0, duplicate: 3, invalid: 2 });
    expect((await call('analyze')).body.data.ready).toBe(0);
    const { listCompositions } = await import('../../src/modules/zhihu/services/compositions.service');
    expect((await listCompositions(user, { page: 1, pageSize: 100 })).total).toBe(2);
  });
  it('并发导入相同链接只写一条', async () => {
    const upload = file([row('https://v.kuaishou.com/Concurrent')]);
    const receipts = await Promise.all([service.commitCompositionImport(user, upload, options), service.commitCompositionImport(user, upload, options)]);
    expect(receipts.map(result => result.created).sort()).toEqual([0, 1]);
    const [count] = await c.query<RowDataPacket[]>("SELECT COUNT(*) total FROM compositions WHERE promo_url='https://v.kuaishou.com/Concurrent'");
    expect(count[0].total).toBe(1);
  });
  it('先前无效行不阻止同链接的完整行；不静默修正关键词', async () => {
    const result = await service.analyzeCompositionImport(user, file([row('https://v.kuaishou.com/CompleteLater', ''), row('https://v.kuaishou.com/CompleteLater'), row('https://v.kuaishou.com/WrongWord', '可用计画')]), options);
    expect(result).toMatchObject({ ready: 1, invalid: 2, duplicate: 0 });
  });
  it('禁止越权计划，且失败的同步入队不能掩盖实际入库成功', async () => {
    const outsider = { ...user, sub: '2', role: 'creator' } as AuthUser;
    const denied = await service.analyzeCompositionImport(outsider, file([row('https://v.kuaishou.com/Forbidden')]), options);
    expect(denied.ready).toBe(0);
    const { enqueue } = await import('../../src/modules/zhihu/queue');
    vi.mocked(enqueue).mockRejectedValueOnce(new Error('queue unavailable'));
    const result = await service.commitCompositionImport(user, file([row('https://v.kuaishou.com/QueueDown')]), options);
    expect(result.created).toBe(1);
    expect(result.queueFailed).toEqual(result.ids);
    expect((await service.commitCompositionImport(user, file([row('https://v.kuaishou.com/QueueDown')]), options)).created).toBe(0);
  });
  it('本地批次持久保存原表和问题行，重复保存同一文件不新增批次且不推送', async () => {
    const { compositionsRouter } = await import('../../src/modules/zhihu/routes/compositions');
    const { errorHandler } = await import('../../src/middleware/errors');
    const { enqueue } = await import('../../src/modules/zhihu/queue');
    const callsBefore = vi.mocked(enqueue).mock.calls.length;
    const app = express().use('/compositions', compositionsRouter).use(errorHandler);
    const upload = file([row('https://v.kuaishou.com/AlreadyOnline'), row('https://v.kuaishou.com/LocalDraft', '本地尚无计划'), row('https://v.kuaishou.com/LocalDraft', '本地尚无计划'), row('https://v.kuaishou.com/NeedsMore', ''), row('https://v.kuaishou.com/ImportA')]);
    const draftOptions = { ...options, knownExternal: { site: 'https://example.com/works', checkedAt: '2026-09-21', links: ['https://v.kuaishou.com/AlreadyOnline'] } };
    const save = () => request(app).post('/compositions/import/draft').field('options', JSON.stringify(draftOptions)).attach('file', upload.buffer, { filename: upload.originalname });
    const first = await save();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data).toMatchObject({ total: 5, pending: 2, duplicate: 3, ready: 0, delivery: 'local_only' });
    const second = await save();
    expect(second.body.data.id).toBe(first.body.data.id);
    const listed = await request(app).get('/compositions/import/drafts');
    expect(listed.body.data.total).toBe(1);
    const detail = await request(app).get(`/compositions/import/drafts/${first.body.data.id}`);
    expect(detail.body.data.preview.rows).toHaveLength(5);
    expect(detail.body.data.options.knownExternal.links).toEqual(draftOptions.knownExternal.links);
    const original = await request(app).get(`/compositions/import/drafts/${first.body.data.id}/file`);
    expect(Buffer.compare(original.body, upload.buffer)).toBe(0);
    const drafts = await import('../../src/modules/zhihu/services/composition-import-drafts.service');
    await expect(drafts.getWorkImportDraft({ ...user, sub: '2', role: 'creator' }, first.body.data.id)).rejects.toThrow('找不到');
    expect(vi.mocked(enqueue).mock.calls).toHaveLength(callsBefore);
  });
});
