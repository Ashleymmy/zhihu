import { deflateRawSync } from 'node:zlib';

export interface XlsxZipFixtureEntry {
  readonly name: string;
  readonly data: string | Buffer;
  readonly method?: 0 | 8;
  readonly flags?: number;
  readonly localName?: string;
  readonly localExtra?: Buffer;
  readonly centralExtra?: Buffer;
  readonly comment?: Buffer;
  readonly externalAttributes?: number;
  readonly madeBy?: number;
  readonly declaredCrc?: number;
  readonly declaredCompressedSize?: number;
  readonly declaredUncompressedSize?: number;
}

export interface XlsxZipFixtureOptions {
  readonly prefix?: Buffer;
  readonly suffix?: Buffer;
  readonly archiveComment?: Buffer;
  readonly diskNumber?: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320;
    table[index] = value >>> 0;
  }
  return table;
})();

function fixtureCrc32(buffer: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function bytes(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8');
}

export function buildXlsxZipFixture(
  entries: readonly XlsxZipFixtureEntry[],
  options: XlsxZipFixtureOptions = {},
): Buffer {
  const prefix = options.prefix ?? Buffer.alloc(0);
  const localParts: Buffer[] = [prefix];
  const centralParts: Buffer[] = [];
  let localOffset = prefix.length;

  for (const entry of entries) {
    const input = bytes(entry.data);
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(input) : Buffer.from(input);
    const flags = entry.flags ?? 0;
    const localName = Buffer.from(entry.localName ?? entry.name, 'utf8');
    const centralName = Buffer.from(entry.name, 'utf8');
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const comment = entry.comment ?? Buffer.alloc(0);
    const crc = entry.declaredCrc ?? fixtureCrc32(input);
    const compressedSize = entry.declaredCompressedSize ?? compressed.length;
    const uncompressedSize = entry.declaredUncompressedSize ?? input.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(crc >>> 0, 14);
    localHeader.writeUInt32LE(compressedSize >>> 0, 18);
    localHeader.writeUInt32LE(uncompressedSize >>> 0, 22);
    localHeader.writeUInt16LE(localName.length, 26);
    localHeader.writeUInt16LE(localExtra.length, 28);
    localParts.push(localHeader, localName, localExtra, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(entry.madeBy ?? 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(crc >>> 0, 16);
    centralHeader.writeUInt32LE(compressedSize >>> 0, 20);
    centralHeader.writeUInt32LE(uncompressedSize >>> 0, 24);
    centralHeader.writeUInt16LE(centralName.length, 28);
    centralHeader.writeUInt16LE(centralExtra.length, 30);
    centralHeader.writeUInt16LE(comment.length, 32);
    centralHeader.writeUInt16LE(options.diskNumber ?? 0, 34);
    centralHeader.writeUInt32LE((entry.externalAttributes ?? 0) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, centralName, centralExtra, comment);

    localOffset += localHeader.length + localName.length + localExtra.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const archiveComment = options.archiveComment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.diskNumber ?? 0, 4);
  eocd.writeUInt16LE(options.diskNumber ?? 0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(archiveComment.length, 20);
  return Buffer.concat([...localParts, centralDirectory, eocd, archiveComment, options.suffix ?? Buffer.alloc(0)]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELATIONSHIPS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELATIONSHIPS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

const WORKSHEET = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>safe</t></is></c></row></sheetData>
</worksheet>`;

export function minimalXlsxEntries(method: 0 | 8 = 0): XlsxZipFixtureEntry[] {
  return [
    { name: '[Content_Types].xml', data: CONTENT_TYPES, method },
    { name: '_rels/.rels', data: ROOT_RELATIONSHIPS, method },
    { name: 'xl/workbook.xml', data: WORKBOOK, method },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELATIONSHIPS, method },
    { name: 'xl/worksheets/sheet1.xml', data: WORKSHEET, method },
  ];
}

export function buildMinimalXlsxFixture(method: 0 | 8 = 0): Buffer {
  return buildXlsxZipFixture(minimalXlsxEntries(method));
}

export const allianceXlsxFixtureXml = Object.freeze({
  contentTypes: CONTENT_TYPES,
  rootRelationships: ROOT_RELATIONSHIPS,
  workbook: WORKBOOK,
  workbookRelationships: WORKBOOK_RELATIONSHIPS,
  worksheet: WORKSHEET,
});
