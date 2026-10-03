import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { importOptionsSchema } from '../../src/modules/zhihu/services/composition-import-parser';
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('../../src/db', () => ({ db: { getConnection: async () => ({ query: mocks.query, release: mocks.release }) } }));
vi.mock('../../src/modules/zhihu/services/compositions.service', () => ({ insertComposition: vi.fn() }));
vi.mock('../../src/modules/zhihu/queue', () => ({ enqueue: vi.fn() }));
import { analyzeCompositionImport } from '../../src/modules/zhihu/services/composition-import.service';
import type { AuthUser } from '../../src/types';
const user = { sub: '1', role: 'admin', username: 'test', displayName: 'test', parentId: null, jti: 'test' } as AuthUser;
function file() {
 const book = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ['推广计划', '媒体类型', '推广链接', '作品分类', '作品子分类', '发布时间', '关键词', '媒体账号', '标题'],
  ['', '抖音', 'https://v.douyin.com/DWq3Z1dWKbY/ f@o.qE :6pm oQx:/ 06/27 ', '视频', '解压', '', '岁岁共同舟', '77592572371', '岁岁共同舟'],
 ]), '视频链接回填');
 return { originalname: '多平台作品回填.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer };
}
describe('多平台作品回填分析', () => {
 it('完整识别表中业务字段，只提示真实缺失的日期，补日期后即可上传', async () => {
  mocks.query.mockImplementation(async (sql: string) => sql.includes('SELECT p.id, p.keyword') ? [[{ id: '123', keyword: '岁岁共同舟', status: 'active' }]] : [[]]);
  const missing = await analyzeCompositionImport(user, file(), importOptionsSchema.parse({}));
  expect(missing.rows[0].keyword).toBe('岁岁共同舟');
  expect(missing.rows[0].errors).toEqual(['发布时间缺失或无效，请填写完整日期']);
  const ready = await analyzeCompositionImport(user, file(), importOptionsSchema.parse({ defaults: { releaseTime: '2026-10-03 12:00' } }));
  expect(ready).toMatchObject({ ready: 1, invalid: 0 });
  expect(ready.rows[0].input).toMatchObject({ planId: '123', mediaType: 'KOC抖音', mediaAccount: '77592572371', compositionType: 2, compositionSubType: 9, promoUrl: 'https://v.douyin.com/DWq3Z1dWKbY/' });
 });
});
