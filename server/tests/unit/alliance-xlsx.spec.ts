import { describe, expect, it } from 'vitest';
import {
  AllianceXlsxValidationError,
  isSafeXlsxFilename,
  validateAllianceXlsx,
  validateAllianceXlsxBuffer,
  XLSX_MIME,
} from '../../src/zhihu/allianceXlsx';
import {
  allianceXlsxFixtureXml,
  buildMinimalXlsxFixture,
  buildXlsxZipFixture,
  minimalXlsxEntries,
  type XlsxZipFixtureEntry,
} from '../support/allianceXlsxFixture';

function upload(buffer: Buffer, overrides: Partial<{ originalname: string; mimetype: string; size: number }> = {}) {
  return {
    originalname: overrides.originalname ?? 'batch.xlsx',
    mimetype: overrides.mimetype ?? XLSX_MIME,
    size: overrides.size ?? buffer.length,
    buffer,
  };
}

function replacePart(name: string, data: string | Buffer, method: 0 | 8 = 0): XlsxZipFixtureEntry[] {
  return minimalXlsxEntries(method).map((entry) => (entry.name === name ? { ...entry, data } : entry));
}

async function rejects(buffer: Buffer): Promise<void> {
  await expect(validateAllianceXlsxBuffer(buffer)).rejects.toBeInstanceOf(AllianceXlsxValidationError);
}

describe('Alliance XLSX fail-closed validator', () => {
  it('P0007-R3-ZIP-001 accepts independent minimal stored and deflate OOXML fixtures', async () => {
    await expect(validateAllianceXlsx(upload(buildMinimalXlsxFixture(0)))).resolves.toBeUndefined();
    await expect(validateAllianceXlsx(upload(buildMinimalXlsxFixture(8)))).resolves.toBeUndefined();
  });

  it('P0007-R3-MIME-001 enforces safe filename, exact MIME, size, and ZIP magic', async () => {
    const valid = buildMinimalXlsxFixture();
    expect(isSafeXlsxFilename('安全批量.XLSX')).toBe(true);
    for (const originalname of [
      'batch.csv',
      'batch.xlsx ',
      '../batch.xlsx',
      'C:batch.xlsx',
      'batch\\evil.xlsx',
      'batch\u202e.xlsx',
      'batch\u0000.xlsx',
    ]) {
      await expect(validateAllianceXlsx(upload(valid, { originalname }))).rejects.toBeInstanceOf(
        AllianceXlsxValidationError,
      );
    }
    for (const mimetype of ['', 'application/zip', 'application/octet-stream']) {
      await expect(validateAllianceXlsx(upload(valid, { mimetype }))).rejects.toBeInstanceOf(
        AllianceXlsxValidationError,
      );
    }
    await expect(validateAllianceXlsx(upload(valid, { size: valid.length + 1 }))).rejects.toBeInstanceOf(
      AllianceXlsxValidationError,
    );
    await rejects(Buffer.from('PK-not-a-workbook'));
  });

  it('P0007-R3-ZIP-001 rejects CRC, local/central, flags, ZIP64, prefix, and trailing mutations', async () => {
    await rejects(
      buildXlsxZipFixture([{ ...minimalXlsxEntries()[0], declaredCrc: 1 }, ...minimalXlsxEntries().slice(1)]),
    );
    await rejects(
      buildXlsxZipFixture([
        { ...minimalXlsxEntries()[0], localName: 'xl/workbook.xml' },
        ...minimalXlsxEntries().slice(1),
      ]),
    );
    await rejects(
      buildXlsxZipFixture([{ ...minimalXlsxEntries()[0], flags: 0x0008 }, ...minimalXlsxEntries().slice(1)]),
    );
    const zip64Extra = Buffer.from([0x01, 0x00, 0x00, 0x00]);
    await rejects(
      buildXlsxZipFixture([
        { ...minimalXlsxEntries()[0], localExtra: zip64Extra, centralExtra: zip64Extra },
        ...minimalXlsxEntries().slice(1),
      ]),
    );
    await rejects(buildXlsxZipFixture(minimalXlsxEntries(), { prefix: Buffer.from('SFX') }));
    await rejects(buildXlsxZipFixture(minimalXlsxEntries(), { suffix: Buffer.from('polyglot') }));
    await rejects(buildXlsxZipFixture(minimalXlsxEntries(), { archiveComment: Buffer.from('comment') }));
  });

  it('P0007-R3-PATH-001 rejects traversal, duplicate identity, directory, and special-file entries', async () => {
    for (const name of [
      '../[Content_Types].xml',
      '/[Content_Types].xml',
      'xl//workbook.xml',
      'xl/./workbook.xml',
      'xl\\workbook.xml',
      'xl/workbook.xml/',
      'xl/wörkbook.xml',
    ]) {
      await rejects(buildXlsxZipFixture([{ ...minimalXlsxEntries()[0], name }, ...minimalXlsxEntries().slice(1)]));
    }
    await rejects(
      buildXlsxZipFixture([...minimalXlsxEntries(), { ...minimalXlsxEntries()[2], name: 'XL/WORKBOOK.XML' }]),
    );
    await rejects(
      buildXlsxZipFixture([
        { ...minimalXlsxEntries()[0], madeBy: 0x0314, externalAttributes: 0xa000 << 16 },
        ...minimalXlsxEntries().slice(1),
      ]),
    );
  });

  it('P0007-R3-LIMIT-001 rejects entry-count, per-entry, and compression-ratio declarations before inflate', async () => {
    const tooMany: XlsxZipFixtureEntry[] = [
      ...minimalXlsxEntries().slice(0, 4),
      ...Array.from({ length: 509 }, (_, index) => ({
        name: `xl/worksheets/sheet${index + 1}.xml`,
        data: allianceXlsxFixtureXml.worksheet,
      })),
    ];
    await rejects(buildXlsxZipFixture(tooMany));
    await rejects(
      buildXlsxZipFixture([
        ...minimalXlsxEntries().slice(0, 4),
        {
          ...minimalXlsxEntries()[4],
          method: 8,
          data: `<worksheet>${'a'.repeat(50_000)}</worksheet>`,
        },
      ]),
    );
    await rejects(
      buildXlsxZipFixture([
        { ...minimalXlsxEntries()[0], declaredUncompressedSize: 16 * 1024 * 1024 + 1 },
        ...minimalXlsxEntries().slice(1),
      ]),
    );
  });

  it('P0007-R3-ACTIVE-001 rejects active parts, external/encoded relationships, formulas, and DTD', async () => {
    await rejects(
      buildXlsxZipFixture([...minimalXlsxEntries(), { name: 'xl/vbaProject.bin', data: Buffer.from([1, 2, 3]) }]),
    );

    const external = allianceXlsxFixtureXml.rootRelationships.replace(
      'Target="xl/workbook.xml"',
      'TargetMode="External" Target="https://attacker.invalid/book"',
    );
    await rejects(buildXlsxZipFixture(replacePart('_rels/.rels', external)));

    const encodedExternal = allianceXlsxFixtureXml.rootRelationships.replace(
      'Target="xl/workbook.xml"',
      'TargetMode="Externa&#108;" Target="xl/workbook.xml"',
    );
    await rejects(buildXlsxZipFixture(replacePart('_rels/.rels', encodedExternal)));

    const percentTarget = allianceXlsxFixtureXml.rootRelationships.replace(
      'Target="xl/workbook.xml"',
      'Target="xl/%77orkbook.xml"',
    );
    await rejects(buildXlsxZipFixture(replacePart('_rels/.rels', percentTarget)));

    const formula = allianceXlsxFixtureXml.worksheet.replace('</sheetData>', '<f>1+1</f></sheetData>');
    await rejects(buildXlsxZipFixture(replacePart('xl/worksheets/sheet1.xml', formula)));

    const dtd = `<!DOCTYPE worksheet [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${allianceXlsxFixtureXml.worksheet}`;
    await rejects(buildXlsxZipFixture(replacePart('xl/worksheets/sheet1.xml', dtd)));
  });

  it('P0007-R3-ACTIVE-001 rejects malformed UTF-8, missing required parts, and non-canonical content types', async () => {
    await rejects(buildXlsxZipFixture(replacePart('xl/worksheets/sheet1.xml', Buffer.from([0x3c, 0xff, 0x3e]))));
    await rejects(buildXlsxZipFixture(minimalXlsxEntries().filter((entry) => entry.name !== 'xl/workbook.xml')));
    const macroContentType = allianceXlsxFixtureXml.contentTypes.replace(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
    );
    await rejects(buildXlsxZipFixture(replacePart('[Content_Types].xml', macroContentType)));
  });
});
