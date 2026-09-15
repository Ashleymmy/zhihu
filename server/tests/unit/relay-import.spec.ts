import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { importBatch } from '../../src/modules/zhihu/services/relay.service';
import { XLSX_MIME } from '../../src/modules/zhihu/zhihu/allianceXlsx';
import type { AuthUser } from '../../src/types';

function workbookWithLocalFormula(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['日期时间', '渠道名称', '关键词'],
    ['2026-09-01', '渠道 A', '关键词 A'],
  ]);
  sheet.C2 = { t: 's', v: '关键词 A', f: 'IF(1=1,"关键词 A","")' };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '日报');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('结算批次 XLSX 导入', () => {
  it('允许安全的本地公式通过文件校验，并返回结算模板错误而非文件格式误判', async () => {
    const buffer = workbookWithLocalFormula();
    await expect(
      importBatch(
        {
          sub: '1',
          role: 'admin',
          parentId: null,
          username: 'admin',
          displayName: '管理员',
          jti: 'test',
        } satisfies AuthUser,
        {
          originalname: '知乎结算.xlsx',
          mimetype: XLSX_MIME,
          size: buffer.length,
          buffer,
        },
        { title: '回归测试', periodStart: '2026-09-01', periodEnd: '2026-09-01' },
      ),
    ).rejects.toThrow('未找到表头');
  });
});
