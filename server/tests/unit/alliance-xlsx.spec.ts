import { describe, expect, it } from 'vitest';
import {
  AllianceXlsxValidationError,
  isSafeXlsxFilename,
  validateAllianceXlsx,
  validateAllianceXlsxBuffer,
  isSupportedXlsxMime,
  XLSX_MIME,
} from '../../src/modules/zhihu/zhihu/allianceXlsx';
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

async function rejects(buffer: Buffer, options: { allowFormulas?: boolean } = {}): Promise<void> {
  await expect(validateAllianceXlsxBuffer(buffer, options)).rejects.toBeInstanceOf(AllianceXlsxValidationError);
}

describe('Alliance XLSX fail-closed validator', () => {
  it('accepts unreferenced spreadsheet metadata left by real activation report exports', async () => {
    const metadata = `<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><metadataTypes count="1"><metadataType name="XLDAPR"/></metadataTypes></metadata>`;
    const entries = [...minimalXlsxEntries(8), { name: 'xl/metadata.xml', data: metadata }];
    await expect(validateAllianceXlsxBuffer(buildXlsxZipFixture(entries))).resolves.toBeUndefined();
    for (const data of [metadata.replace('<metadata ', '<worksheet ').replace('</metadata>', '</worksheet>'), metadata.replace('spreadsheetml/2006/main', 'unexpected'), metadata.replace('</metadata>', '<script/></metadata>')]) {
      await rejects(buildXlsxZipFixture([...entries.slice(0, -1), { name: 'xl/metadata.xml', data }]));
    }
  });

  it('still requires the declared metadata type when the workbook references it', async () => {
    const entries = minimalXlsxEntries().map((entry) => entry.name === 'xl/_rels/workbook.xml.rels'
      ? { ...entry, data: String(entry.data).replace('</Relationships>', '<Relationship Id="metadata" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>') }
      : entry);
    await rejects(buildXlsxZipFixture([...entries, { name: 'xl/metadata.xml', data: '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>' }]));
    await rejects(buildXlsxZipFixture([...minimalXlsxEntries(), { name: 'xl/styles.xml', data: '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>' }]));
  });

  it('P0007-R3-ZIP-001 accepts independent minimal stored and deflate OOXML fixtures', async () => {
    await expect(validateAllianceXlsx(upload(buildMinimalXlsxFixture(0)))).resolves.toBeUndefined();
    await expect(validateAllianceXlsx(upload(buildMinimalXlsxFixture(8)))).resolves.toBeUndefined();
  });

  it.each([0, 8] as const)(
    'accepts streamed ZIP entries with method %i and optional descriptor signatures',
    async (method) => {
      for (const dataDescriptor of ['signed', 'unsigned'] as const) {
        for (const populateLocalHeader of [false, true]) {
          const entries = minimalXlsxEntries(method).map((entry) => ({
            ...entry,
            dataDescriptor,
            populateLocalHeader,
          }));
          await expect(validateAllianceXlsx(upload(buildXlsxZipFixture(entries)))).resolves.toBeUndefined();
        }
      }
    },
  );

  it('accepts a mix of streamed and non-streamed parts regardless of central-directory order', async () => {
    const buffer = buildXlsxZipFixture(
      minimalXlsxEntries(8).map((entry, index) => ({
        ...entry,
        dataDescriptor: index % 2 ? 'signed' : undefined,
      })),
    );
    const centralOffset = buffer.readUInt32LE(buffer.length - 6);
    let cursor = centralOffset;
    const records: Buffer[] = [];
    while (cursor < buffer.length - 22) {
      const length =
        46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
      records.push(buffer.subarray(cursor, cursor + length));
      cursor += length;
    }
    await expect(
      validateAllianceXlsxBuffer(
        Buffer.concat([buffer.subarray(0, centralOffset), ...records.reverse(), buffer.subarray(-22)]),
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects missing, truncated, oversized or unflagged data descriptors', async () => {
    for (const dataDescriptor of [
      Buffer.alloc(0),
      Buffer.alloc(11),
      Buffer.alloc(13),
      Buffer.alloc(15),
      Buffer.alloc(20),
      Buffer.alloc(24),
    ]) {
      await rejects(buildXlsxZipFixture(minimalXlsxEntries(8).map((entry) => ({ ...entry, dataDescriptor }))));
    }
    await rejects(
      buildXlsxZipFixture(
        minimalXlsxEntries(8).map((entry) => ({
          ...entry,
          dataDescriptor: 'signed',
          flags: 0,
          populateLocalHeader: true,
        })),
      ),
    );
  });

  it('rejects mismatched descriptor values, signatures and populated local headers', async () => {
    for (const dataDescriptor of ['signed', 'unsigned'] as const) {
      const valid = buildXlsxZipFixture(minimalXlsxEntries(8).map((entry) => ({ ...entry, dataDescriptor })));
      const centralOffset = valid.readUInt32LE(valid.length - 6);
      const dataStart = 30 + valid.readUInt16LE(26) + valid.readUInt16LE(28);
      const descriptorStart = dataStart + valid.readUInt32LE(centralOffset + 20);
      const descriptorLength = dataDescriptor === 'signed' ? 16 : 12;
      for (let offset = 0; offset < descriptorLength; offset += 4) {
        const bad = Buffer.from(valid);
        bad[descriptorStart + offset] ^= 1;
        await rejects(bad);
      }
      for (const offset of [14, 18, 22]) {
        const bad = Buffer.from(valid);
        bad.writeUInt32LE(1, offset);
        await rejects(bad);
      }
      const overlapping = Buffer.from(valid);
      const secondCentral = centralOffset + 46 + valid.readUInt16LE(centralOffset + 28);
      overlapping.writeUInt32LE(descriptorStart + 4, secondCentral + 42);
      await rejects(overlapping);
    }
  });

  it('still checks actual CRC, encryption, ZIP64, expansion limits and active XML for streamed ZIPs', async () => {
    const entries = minimalXlsxEntries(8).map((entry) => ({ ...entry, dataDescriptor: 'signed' as const }));
    for (const first of [
      { ...entries[0], declaredCrc: 1 },
      { ...entries[0], flags: 0x0009 },
      { ...entries[0], localExtra: Buffer.from([1, 0, 0, 0]) },
      { ...entries[0], declaredUncompressedSize: 16 * 1024 * 1024 + 1 },
      { ...entries[0], data: `<Types>${'a'.repeat(50_000)}</Types>` },
    ]) {
      await rejects(buildXlsxZipFixture([first, ...entries.slice(1)]));
    }
    const external = allianceXlsxFixtureXml.rootRelationships.replace(
      'Target="xl/workbook.xml"',
      'TargetMode="External" Target="https://attacker.invalid/book"',
    );
    await rejects(
      buildXlsxZipFixture(
        entries.map((entry) => (entry.name === '_rels/.rels' ? { ...entry, data: external } : entry)),
      ),
    );
  });

  it('P0007-R3-ZIP-001 accepts empty standard XLSX directory entries', async () => {
    const directories: XlsxZipFixtureEntry[] = [
      { name: '_rels/', data: Buffer.alloc(0), method: 0, externalAttributes: 0x10 },
      { name: 'docProps/', data: Buffer.alloc(0), method: 0, externalAttributes: 0x10 },
      { name: 'xl/', data: Buffer.alloc(0), method: 0, externalAttributes: 0x10 },
      { name: 'xl/worksheets/', data: Buffer.alloc(0), method: 0, externalAttributes: 0x10 },
    ];
    await expect(
      validateAllianceXlsxBuffer(buildXlsxZipFixture([...directories, ...minimalXlsxEntries()])),
    ).resolves.toBeUndefined();
  });

  it('resolves sheet relationship IDs by namespace on workbook, sheets or sheet elements', async () => {
    const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const aliased = allianceXlsxFixtureXml.workbook
      .replace(` xmlns:r="${ns}"`, '')
      .replace('r:id=', 'relationships:id=');
    for (const declarationTarget of ['<workbook ', '<sheets', '<sheet ']) {
      const workbook = aliased.replace(
        declarationTarget,
        `${declarationTarget.trimEnd()} xmlns:relationships="${ns}" `,
      );
      await expect(
        validateAllianceXlsxBuffer(buildXlsxZipFixture(replacePart('xl/workbook.xml', workbook))),
      ).resolves.toBeUndefined();
    }
  });

  it('rejects undeclared, wrong, shadowed or duplicate sheet relationship namespaces and missing targets', async () => {
    const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const workbook = allianceXlsxFixtureXml.workbook;
    for (const bad of [
      workbook.replace(` xmlns:r="${ns}"`, ''),
      workbook.replace(`xmlns:r="${ns}"`, 'xmlns:r="urn:wrong"'),
      workbook.replace('<sheets>', '<sheets xmlns:r="urn:wrong">'),
      workbook.replace('r:id="rId1"', 'r:id="missing"'),
      workbook.replace('r:id="rId1"', `r:id="rId1" xmlns:other="${ns}" other:id="rId1"`),
      workbook.replace(` xmlns:r="${ns}"`, '').replace('<sheets>', `<bookViews xmlns:r="${ns}"/><sheets>`),
    ]) {
      await rejects(buildXlsxZipFixture(replacePart('xl/workbook.xml', bad)));
    }
  });

  it('P0007-R3-MIME-001 accepts common XLSX MIME variants and enforces safe filename, size, and ZIP magic', async () => {
    const valid = buildMinimalXlsxFixture();
    expect(isSafeXlsxFilename('安全批量.XLSX')).toBe(true);
    for (const mimetype of [
      XLSX_MIME,
      'application/vnd.ms-excel',
      'application/zip',
      'application/octet-stream',
      XLSX_MIME + '; charset=binary',
      'APPLICATION/OCTET-STREAM',
    ]) {
      expect(isSupportedXlsxMime(mimetype)).toBe(true);
      await expect(validateAllianceXlsx(upload(valid, { mimetype }))).resolves.toBeUndefined();
    }
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
    for (const mimetype of ['', 'text/plain', 'application/pdf']) {
      expect(isSupportedXlsxMime(mimetype)).toBe(false);
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

  it('accepts standard relative relationship targets without allowing package-root escape', async () => {
    const contentTypes = allianceXlsxFixtureXml.contentTypes.replace(
      '</Types>',
      '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>',
    );
    const tableRelationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>
</Relationships>`;
    const table = `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`;
    const entries = [
      ...minimalXlsxEntries().map((entry) =>
        entry.name === '[Content_Types].xml' ? { ...entry, data: contentTypes } : entry,
      ),
      { name: 'xl/tables/table1.xml', data: table },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: tableRelationships },
    ];
    await expect(validateAllianceXlsxBuffer(buildXlsxZipFixture(entries))).resolves.toBeUndefined();

    const escape = tableRelationships.replace('../tables/table1.xml', '../../../tables/table1.xml');
    await rejects(
      buildXlsxZipFixture([...entries.slice(0, -1), { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: escape }]),
    );
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

  it('allows local formulas only when explicitly enabled for data import', async () => {
    const safeFormula = allianceXlsxFixtureXml.worksheet.replace('</sheetData>', '<f>IF(A1=0,1,2)</f></sheetData>');
    await expect(
      validateAllianceXlsxBuffer(buildXlsxZipFixture(replacePart('xl/worksheets/sheet1.xml', safeFormula)), {
        allowFormulas: true,
      }),
    ).resolves.toBeUndefined();

    const externalFormula = safeFormula.replace('IF(A1=0,1,2)', 'HYPERLINK("https://attacker.invalid")');
    await rejects(buildXlsxZipFixture(replacePart('xl/worksheets/sheet1.xml', externalFormula)), {
      allowFormulas: true,
    });
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
