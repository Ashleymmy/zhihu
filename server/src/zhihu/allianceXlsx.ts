import { inflateRaw } from 'node:zlib';
import { TextDecoder } from 'node:util';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;
export const XLSX_MAX_BYTES = 10 * 1024 * 1024;
export const XLSX_MAX_ENTRIES = 512;
export const XLSX_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const XLSX_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const XLSX_MAX_XML_BYTES = 8 * 1024 * 1024;
export const XLSX_MAX_COMPRESSION_RATIO = 100;

/** All upload failures intentionally share one non-sensitive public error. */
export class AllianceXlsxValidationError extends Error {
  constructor() {
    super('上传文件不符合要求');
    this.name = 'AllianceXlsxValidationError';
  }
}

export interface AllianceUploadFile {
  readonly originalname: unknown;
  readonly mimetype: unknown;
  readonly size?: unknown;
  readonly buffer: unknown;
}

interface ZipEntry {
  readonly name: string;
  readonly nameBytes: Buffer;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly dataStart: number;
  readonly dataEnd: number;
}

interface XmlAttribute {
  readonly name: string;
  readonly value: string;
}

interface XmlToken {
  readonly name: string;
  readonly attrs: readonly XmlAttribute[];
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly depth: number;
}

const REQUIRED_PARTS = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'] as const;

const ALLOWED_PART_PATTERN =
  /^(?:\[Content_Types\]\.xml|_rels\/\.rels|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/sheet[1-9][0-9]*\.xml|docProps\/(?:app|core|custom)\.xml|xl\/styles\.xml|xl\/sharedStrings\.xml|xl\/metadata\.xml|xl\/theme\/theme[1-9][0-9]*\.xml|xl\/tables\/table[1-9][0-9]*\.xml|xl\/worksheets\/_rels\/sheet[1-9][0-9]*\.xml\.rels)$/u;

const ACTIVE_PART_PATTERN =
  /(?:\.bin$|vbaProject|activeX|oleObject|embeddings|externalLinks|connections|queryTables|customUI|_xmlsignatures|origin\.sigs|macro|dialog)/iu;

const CONTENT_TYPE_ALLOWLIST = new Set([
  'application/xml',
  'application/vnd.openxmlformats-package.relationships+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml',
  'application/vnd.openxmlformats-officedocument.theme+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml',
  'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  'application/vnd.openxmlformats-package.core-properties+xml',
  'application/vnd.openxmlformats-officedocument.custom-properties+xml',
]);

const RELATIONSHIP_TYPES = Object.freeze({
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  worksheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  sharedStrings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings',
  sheetMetadata: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  table: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extended: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  custom: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',
} as const);

const ALLOWED_RELATIONSHIP_TYPES = new Set<string>(Object.values(RELATIONSHIP_TYPES));
const DANGEROUS_XML_NAMES = new Set([
  'f',
  'formula',
  'formula1',
  'formula2',
  'definedname',
  'externalreference',
  'ddelink',
  'script',
  'object',
  'embed',
  'iframe',
  'html',
  'vbaProject'.toLowerCase(),
  'activex',
  'oleobject',
  'externallink',
  'connections',
  'querytable',
  'customui',
  'signature',
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320;
    table[index] = value >>> 0;
  }
  return table;
})();

function invalid(): never {
  throw new AllianceXlsxValidationError();
}

function u16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) return invalid();
  return buffer.readUInt16LE(offset);
}

function u32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) return invalid();
  return buffer.readUInt32LE(offset);
}

function rangeIsSafe(offset: number, length: number, total: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= total &&
    length <= total - offset
  );
}

function crc32(buffer: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function isXmlWhitespace(value: string): boolean {
  return value === ' ' || value === '\t' || value === '\r' || value === '\n';
}

function validCodePoint(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff) &&
    value !== 0xfffe &&
    value !== 0xffff &&
    (value >= 0x20 || value === 0x09 || value === 0x0a || value === 0x0d)
  );
}

function decodeXmlEntities(value: string, rejectAmpersandResult: boolean): string {
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    const ampersand = value.indexOf('&', cursor);
    if (ampersand < 0) {
      result += value.slice(cursor);
      break;
    }
    result += value.slice(cursor, ampersand);
    const semicolon = value.indexOf(';', ampersand + 1);
    if (semicolon < 0 || semicolon - ampersand > 32) return invalid();
    const entity = value.slice(ampersand + 1, semicolon);
    let decoded: string;
    if (entity === 'amp') decoded = '&';
    else if (entity === 'lt') decoded = '<';
    else if (entity === 'gt') decoded = '>';
    else if (entity === 'quot') decoded = '"';
    else if (entity === 'apos') decoded = "'";
    else if (/^#(?:[0-9]+)$/u.test(entity)) {
      const codePoint = Number(entity.slice(1));
      if (!validCodePoint(codePoint)) return invalid();
      decoded = String.fromCodePoint(codePoint);
    } else if (/^#x[0-9a-f]+$/iu.test(entity)) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      if (!validCodePoint(codePoint)) return invalid();
      decoded = String.fromCodePoint(codePoint);
    } else return invalid();
    if (rejectAmpersandResult && decoded.includes('&')) return invalid();
    result += decoded;
    cursor = semicolon + 1;
  }
  for (const character of result) if (!validCodePoint(character.codePointAt(0) ?? -1)) return invalid();
  return result;
}

function decodeUtf8Xml(bytes: Uint8Array): string {
  let input = bytes;
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) input = input.slice(3);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let value: string;
  try {
    value = decoder.decode(input);
  } catch {
    return invalid();
  }
  if (value.includes('\ufeff') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return invalid();
  if (value.startsWith('<?xml')) {
    const declarationEnd = value.indexOf('?>');
    if (declarationEnd < 0) return invalid();
    validateXmlDeclaration(value.slice(0, declarationEnd + 2));
  }
  return value;
}

function validateXmlDeclaration(value: string): void {
  if (
    !/^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])UTF-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>$/iu.test(
      value,
    )
  ) {
    return invalid();
  }
}

function xmlName(value: string): boolean {
  return /^[A-Za-z_:][A-Za-z0-9_.:-]*$/u.test(value);
}

function localName(value: string): string {
  const separator = value.lastIndexOf(':');
  return (separator < 0 ? value : value.slice(separator + 1)).toLowerCase();
}

function findTagEnd(value: string, start: number): number {
  let quote = '';
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

function parseXml(value: string): readonly XmlToken[] {
  const tokens: XmlToken[] = [];
  const stack: string[] = [];
  let cursor = 0;
  let rootSeen = false;
  let declarationSeen = false;
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor);
    if (start < 0) {
      const text = value.slice(cursor);
      if (stack.length === 0 ? text.trim() !== '' : text.includes('<')) return invalid();
      decodeXmlEntities(text, false);
      cursor = value.length;
      continue;
    }
    const text = value.slice(cursor, start);
    if (stack.length === 0 && text.trim() !== '') return invalid();
    decodeXmlEntities(text, false);
    const end = findTagEnd(value, start + 1);
    if (end < 0) return invalid();
    if (end - start > 64 * 1024) return invalid();
    if (value[start + 1] === '?') {
      if (start !== 0 || declarationSeen || !value.startsWith('<?xml', start) || value[end - 1] !== '?')
        return invalid();
      validateXmlDeclaration(value.slice(start, end + 1));
      declarationSeen = true;
      cursor = end + 1;
      continue;
    }
    if (value[start + 1] === '!') return invalid();
    let raw = value.slice(start + 1, end);
    let closing = false;
    if (raw.startsWith('/')) {
      closing = true;
      raw = raw.slice(1).trim();
      if (!xmlName(raw) || stack.length === 0 || stack[stack.length - 1] !== raw) return invalid();
      const token: XmlToken = { name: raw, attrs: [], closing: true, selfClosing: false, depth: stack.length - 1 };
      tokens.push(token);
      stack.pop();
      cursor = end + 1;
      continue;
    }
    let selfClosing = false;
    if (raw.endsWith('/')) {
      selfClosing = true;
      raw = raw.slice(0, -1);
    }
    let index = 0;
    while (index < raw.length && isXmlWhitespace(raw[index])) index += 1;
    const nameStart = index;
    while (index < raw.length && !isXmlWhitespace(raw[index])) index += 1;
    const name = raw.slice(nameStart, index);
    if (!xmlName(name)) return invalid();
    const attrs: XmlAttribute[] = [];
    const seenAttrs = new Set<string>();
    while (index < raw.length) {
      while (index < raw.length && isXmlWhitespace(raw[index])) index += 1;
      if (index >= raw.length) break;
      const attrStart = index;
      while (index < raw.length && !isXmlWhitespace(raw[index]) && raw[index] !== '=') index += 1;
      const attrName = raw.slice(attrStart, index);
      if (!xmlName(attrName)) return invalid();
      while (index < raw.length && isXmlWhitespace(raw[index])) index += 1;
      if (raw[index] !== '=') return invalid();
      index += 1;
      while (index < raw.length && isXmlWhitespace(raw[index])) index += 1;
      const quote = raw[index];
      if (quote !== '"' && quote !== "'") return invalid();
      index += 1;
      const valueStart = index;
      while (index < raw.length && raw[index] !== quote) index += 1;
      if (index >= raw.length) return invalid();
      const attrValue = decodeXmlEntities(raw.slice(valueStart, index), true);
      index += 1;
      const key = attrName.toLowerCase();
      if (seenAttrs.has(key)) return invalid();
      seenAttrs.add(key);
      attrs.push({ name: attrName, value: attrValue });
      if (attrs.length > 64) return invalid();
    }
    const token: XmlToken = { name, attrs, closing, selfClosing, depth: stack.length };
    tokens.push(token);
    if (!rootSeen) rootSeen = true;
    else if (stack.length === 0) return invalid();
    if (!selfClosing) stack.push(name);
    cursor = end + 1;
  }
  if (!rootSeen || stack.length !== 0 || tokens.length === 0) return invalid();
  return tokens;
}

function attribute(token: XmlToken, name: string): string | undefined {
  return token.attrs.find((item) => item.name === name)?.value;
}

function assertAttributes(token: XmlToken, allowed: readonly string[]): void {
  const names = new Set(allowed);
  for (const item of token.attrs) if (!names.has(item.name)) invalid();
}

function assertNoDangerousXmlTokens(tokens: readonly XmlToken[]): void {
  for (const token of tokens) if (DANGEROUS_XML_NAMES.has(localName(token.name))) invalid();
}

function validatePartNameBytes(nameBytes: Buffer): string {
  if (nameBytes.length < 1 || nameBytes.length > 255) return invalid();
  for (const byte of nameBytes) if (byte < 0x21 || byte > 0x7e || byte === 0x5c || byte === 0x3a) return invalid();
  const name = nameBytes.toString('ascii');
  if (
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.includes('//') ||
    name.split('/').some((segment) => segment === '.' || segment === '..' || segment.length === 0)
  ) {
    return invalid();
  }
  if (!ALLOWED_PART_PATTERN.test(name) || ACTIVE_PART_PATTERN.test(name)) return invalid();
  return name;
}

function validateExtra(buffer: Buffer, offset: number, length: number): void {
  if (!rangeIsSafe(offset, length, buffer.length)) return invalid();
  let cursor = offset;
  const end = offset + length;
  while (cursor < end) {
    if (end - cursor < 4) return invalid();
    const id = u16(buffer, cursor);
    const size = u16(buffer, cursor + 2);
    cursor += 4;
    if (!rangeIsSafe(cursor, size, end)) return invalid();
    if (id === 0x0001 || id === 0x7075) return invalid();
    cursor += size;
  }
  if (cursor !== end) return invalid();
}

function validateFlags(flags: number, method: number): void {
  const allowed = method === 8 ? 0x0806 : 0x0800;
  if ((flags & ~allowed) !== 0 || (flags & 0x0001) !== 0 || (flags & 0x0008) !== 0) return invalid();
}

function validateExternalAttributes(value: number, madeBy: number): void {
  if ((value & 0x10) !== 0) return invalid();
  const platform = madeBy >>> 8;
  if (platform !== 0 && platform !== 3) return invalid();
  if (platform === 3) {
    const mode = (value >>> 16) & 0xffff;
    if (mode !== 0 && (mode & 0xf000) !== 0x8000) return invalid();
  }
}

function parseZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22 || buffer.length > XLSX_MAX_BYTES) return invalid();
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) return invalid();
  const eocdOffset = buffer.length - 22;
  if (u32(buffer, eocdOffset) !== 0x06054b50) return invalid();
  if (u16(buffer, eocdOffset + 4) !== 0 || u16(buffer, eocdOffset + 6) !== 0) return invalid();
  const entriesOnDisk = u16(buffer, eocdOffset + 8);
  const entriesTotal = u16(buffer, eocdOffset + 10);
  const centralSize = u32(buffer, eocdOffset + 12);
  const centralOffset = u32(buffer, eocdOffset + 16);
  if (
    u16(buffer, eocdOffset + 20) !== 0 ||
    entriesOnDisk !== entriesTotal ||
    entriesTotal < 1 ||
    entriesTotal > XLSX_MAX_ENTRIES
  ) {
    return invalid();
  }
  if (!rangeIsSafe(centralOffset, centralSize, eocdOffset) || centralOffset + centralSize !== eocdOffset)
    return invalid();
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  for (let index = 0; index < entriesTotal; index += 1) {
    if (!rangeIsSafe(cursor, 46, eocdOffset) || u32(buffer, cursor) !== 0x02014b50) return invalid();
    const madeBy = u16(buffer, cursor + 4);
    const needed = u16(buffer, cursor + 6);
    const flags = u16(buffer, cursor + 8);
    const method = u16(buffer, cursor + 10);
    const crc = u32(buffer, cursor + 16);
    const compressedSize = u32(buffer, cursor + 20);
    const uncompressedSize = u32(buffer, cursor + 24);
    const nameLength = u16(buffer, cursor + 28);
    const extraLength = u16(buffer, cursor + 30);
    const commentLength = u16(buffer, cursor + 32);
    const diskNumber = u16(buffer, cursor + 34);
    const externalAttributes = u32(buffer, cursor + 38);
    const localOffset = u32(buffer, cursor + 42);
    if (
      needed > 20 ||
      diskNumber !== 0 ||
      commentLength !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    )
      return invalid();
    if (method !== 0 && method !== 8) return invalid();
    validateFlags(flags, method);
    validateExternalAttributes(externalAttributes, madeBy);
    const variableLength = nameLength + extraLength + commentLength;
    if (!rangeIsSafe(cursor + 46, variableLength, eocdOffset)) return invalid();
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = validatePartNameBytes(nameBytes);
    const lowerName = name.toLowerCase();
    if (names.has(lowerName)) return invalid();
    names.add(lowerName);
    validateExtra(buffer, cursor + 46 + nameLength, extraLength);
    if (uncompressedSize > XLSX_MAX_ENTRY_BYTES || (uncompressedSize > 0 && compressedSize === 0)) return invalid();
    if (uncompressedSize > compressedSize * XLSX_MAX_COMPRESSION_RATIO) return invalid();
    entries.push({
      name,
      nameBytes: Buffer.from(nameBytes),
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      dataStart: 0,
      dataEnd: 0,
    });
    cursor += 46 + variableLength;
  }
  if (cursor !== eocdOffset) return invalid();
  const withRanges = entries.map((entry) => {
    const local = entry.localOffset;
    if (!rangeIsSafe(local, 30, centralOffset) || u32(buffer, local) !== 0x04034b50) return invalid();
    const needed = u16(buffer, local + 4);
    const flags = u16(buffer, local + 6);
    const method = u16(buffer, local + 8);
    const crc = u32(buffer, local + 14);
    const compressedSize = u32(buffer, local + 18);
    const uncompressedSize = u32(buffer, local + 22);
    const nameLength = u16(buffer, local + 26);
    const extraLength = u16(buffer, local + 28);
    if (
      needed > 20 ||
      flags !== entry.flags ||
      method !== entry.method ||
      crc !== entry.crc ||
      compressedSize !== entry.compressedSize ||
      uncompressedSize !== entry.uncompressedSize
    )
      return invalid();
    if (!rangeIsSafe(local + 30, nameLength + extraLength, centralOffset)) return invalid();
    const nameBytes = buffer.subarray(local + 30, local + 30 + nameLength);
    if (!nameBytes.equals(entry.nameBytes)) return invalid();
    validateExtra(buffer, local + 30 + nameLength, extraLength);
    const dataStart = local + 30 + nameLength + extraLength;
    if (!rangeIsSafe(dataStart, entry.compressedSize, centralOffset)) return invalid();
    return { ...entry, dataStart, dataEnd: dataStart + entry.compressedSize };
  });
  const ordered = [...withRanges].sort((left, right) => left.localOffset - right.localOffset);
  let expectedOffset = 0;
  for (const entry of ordered) {
    if (entry.localOffset !== expectedOffset || entry.dataEnd < entry.dataStart) return invalid();
    expectedOffset = entry.dataEnd;
  }
  if (expectedOffset !== centralOffset) return invalid();
  return withRanges;
}

function inflateEntry(buffer: Buffer, entry: ZipEntry): Promise<Buffer> {
  if (entry.method === 0) return Promise.resolve(Buffer.from(buffer.subarray(entry.dataStart, entry.dataEnd)));
  return new Promise((resolve, reject) => {
    inflateRaw(
      buffer.subarray(entry.dataStart, entry.dataEnd),
      { maxOutputLength: entry.uncompressedSize + 1 },
      (error, output) => (error ? reject(error) : resolve(output)),
    );
  });
}

function assertRelationshipTarget(sourceRels: string, target: string): string {
  if (
    target.length === 0 ||
    target.includes('%') ||
    target.includes('\\') ||
    target.startsWith('/') ||
    target.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target) ||
    target.includes(':')
  ) {
    return invalid();
  }
  const base = sourceRels === '_rels/.rels' ? '' : sourceRels.replace(/\/_rels\/[^/]+\.rels$/u, '');
  const segments = [...(base ? base.split('/') : []), ...target.split('/')];
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return invalid();
  return segments.join('/');
}

function parseContentTypes(parts: ReadonlyMap<string, string>): void {
  const text = parts.get('[Content_Types].xml');
  if (text === undefined) return invalid();
  const tokens = parseXml(text);
  assertNoDangerousXmlTokens(tokens);
  const root = tokens.find((token) => !token.closing && token.depth === 0);
  if (!root || localName(root.name) !== 'types') return invalid();
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const token of tokens) {
    if (token.closing || token.depth === 0) continue;
    const kind = localName(token.name);
    if (token.depth !== 1 || (kind !== 'default' && kind !== 'override')) return invalid();
    if (kind === 'default') {
      assertAttributes(token, ['Extension', 'ContentType']);
      const extension = attribute(token, 'Extension');
      const contentType = attribute(token, 'ContentType');
      if (
        !extension ||
        !contentType ||
        // 真实 Excel/SheetJS 文件常声明图片等资源的 Default 类型；扩展名声明本身不构成部件，
        // 真正的部件仍受 ALLOWED_PART_PATTERN 与 ACTIVE_PART_PATTERN 约束
        !/^(?:xml|rels|png|jpe?g|gif|bmp|tiff?|emf|wmf|vml|bin|data|pdf)$/iu.test(extension) ||
        defaults.has(extension.toLowerCase()) ||
        (extension.toLowerCase() === 'rels' &&
          contentType !== 'application/vnd.openxmlformats-package.relationships+xml') ||
        (extension.toLowerCase() === 'xml' && contentType !== 'application/xml')
      ) {
        return invalid();
      }
      defaults.set(extension.toLowerCase(), contentType);
    } else {
      assertAttributes(token, ['PartName', 'ContentType']);
      const partName = attribute(token, 'PartName');
      const contentType = attribute(token, 'ContentType');
      if (!partName || !contentType || !partName.startsWith('/') || partName.includes('%') || overrides.has(partName))
        return invalid();
      overrides.set(partName, contentType);
    }
  }
  if (
    overrides.get('/xl/workbook.xml') !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
  ) {
    return invalid();
  }
  for (const partName of overrides.keys()) if (!parts.has(partName.slice(1))) return invalid();
  for (const [name] of parts) {
    const override = overrides.get(`/${name}`);
    const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const contentType = override ?? defaults.get(extension);
    if (!contentType || !CONTENT_TYPE_ALLOWLIST.has(contentType)) return invalid();
    const expectedType =
      name === '[Content_Types].xml'
        ? 'application/xml'
        : name.endsWith('.rels')
          ? 'application/vnd.openxmlformats-package.relationships+xml'
          : name === 'xl/workbook.xml'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
            : /^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/u.test(name)
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
              : name === 'xl/styles.xml'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'
                : name === 'xl/sharedStrings.xml'
                  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'
                  : /^xl\/theme\/theme[1-9][0-9]*\.xml$/u.test(name)
                    ? 'application/vnd.openxmlformats-officedocument.theme+xml'
                    : /^xl\/tables\/table[1-9][0-9]*\.xml$/u.test(name)
                      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml'
                      : name === 'xl/metadata.xml'
                        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml'
                        : name === 'docProps/app.xml'
                        ? 'application/vnd.openxmlformats-officedocument.extended-properties+xml'
                        : name === 'docProps/core.xml'
                          ? 'application/vnd.openxmlformats-package.core-properties+xml'
                          : 'application/vnd.openxmlformats-officedocument.custom-properties+xml';
    if (contentType !== expectedType) return invalid();
  }
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

function parseRelationships(parts: ReadonlyMap<string, string>, sourceRels: string): Relationship[] {
  const text = parts.get(sourceRels);
  if (text === undefined) return invalid();
  const tokens = parseXml(text);
  assertNoDangerousXmlTokens(tokens);
  const root = tokens.find((token) => !token.closing && token.depth === 0);
  if (!root || localName(root.name) !== 'relationships') return invalid();
  const result: Relationship[] = [];
  const ids = new Set<string>();
  for (const token of tokens) {
    if (token.closing || token.depth === 0) continue;
    if (token.depth !== 1 || localName(token.name) !== 'relationship') return invalid();
    assertAttributes(token, ['Id', 'Type', 'Target', 'TargetMode']);
    const id = attribute(token, 'Id');
    const type = attribute(token, 'Type');
    const targetMode = attribute(token, 'TargetMode');
    const target = attribute(token, 'Target');
    if (!id || !type || !target || ids.has(id) || !ALLOWED_RELATIONSHIP_TYPES.has(type)) return invalid();
    if (targetMode !== undefined && targetMode.toLowerCase() !== 'internal') return invalid();
    const resolved = assertRelationshipTarget(sourceRels, target);
    if (!parts.has(resolved)) return invalid();
    ids.add(id);
    result.push({ id, type, target: resolved });
  }
  return result;
}

function validateWorkbook(parts: ReadonlyMap<string, string>, workbookRelationships: readonly Relationship[]): void {
  const text = parts.get('xl/workbook.xml');
  if (text === undefined) return invalid();
  const tokens = parseXml(text);
  assertNoDangerousXmlTokens(tokens);
  const root = tokens.find((token) => !token.closing && token.depth === 0);
  if (!root || localName(root.name) !== 'workbook') return invalid();
  const sheetIds = new Set<string>();
  let sheetsDepth = -1;
  for (const token of tokens) {
    if (token.closing) continue;
    const kind = localName(token.name);
    if (kind === 'sheets') {
      if (sheetsDepth >= 0 || token.depth !== 1) return invalid();
      sheetsDepth = token.depth;
    }
    if (kind !== 'sheet') continue;
    if (token.depth !== sheetsDepth + 1) return invalid();
    const id = attribute(token, 'r:id');
    if (!id || sheetIds.has(id)) return invalid();
    const relationship = workbookRelationships.find((item) => item.id === id);
    if (
      !relationship ||
      relationship.type !== RELATIONSHIP_TYPES.worksheet ||
      !/^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/u.test(relationship.target)
    )
      return invalid();
    sheetIds.add(id);
  }
  if (sheetIds.size < 1) return invalid();
}

function validateRelationships(parts: ReadonlyMap<string, string>): void {
  const rootRelationships = parseRelationships(parts, '_rels/.rels');
  const officeDocuments = rootRelationships.filter((item) => item.type === RELATIONSHIP_TYPES.officeDocument);
  if (officeDocuments.length !== 1 || officeDocuments[0].target !== 'xl/workbook.xml') return invalid();
  const workbookRelationships = parseRelationships(parts, 'xl/_rels/workbook.xml.rels');
  validateWorkbook(parts, workbookRelationships);
  for (const name of parts.keys())
    if (name.endsWith('.rels') && name !== '_rels/.rels' && name !== 'xl/_rels/workbook.xml.rels')
      parseRelationships(parts, name);
}

async function validateBuffer(buffer: Buffer): Promise<void> {
  const entries = parseZipEntries(buffer);
  let totalUncompressed = 0;
  const parts = new Map<string, string>();
  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > XLSX_MAX_TOTAL_BYTES || entry.uncompressedSize > XLSX_MAX_XML_BYTES) return invalid();
    let output: Buffer | undefined;
    try {
      output = await inflateEntry(buffer, entry);
      if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc) return invalid();
      parts.set(entry.name, decodeUtf8Xml(output));
    } catch (error) {
      if (error instanceof AllianceXlsxValidationError) throw error;
      return invalid();
    } finally {
      output?.fill(0);
      output = undefined;
    }
  }
  for (const name of REQUIRED_PARTS) if (!parts.has(name)) return invalid();
  if (![...parts.keys()].some((name) => /^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/u.test(name))) return invalid();
  for (const text of parts.values()) assertNoDangerousXmlTokens(parseXml(text));
  parseContentTypes(parts);
  validateRelationships(parts);
}

export function isSafeXlsxFilename(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const name = value.normalize('NFC');
  if (
    name.length < 5 ||
    Buffer.byteLength(name, 'utf8') < 1 ||
    Buffer.byteLength(name, 'utf8') > 255 ||
    name.trim() !== name ||
    /[\u0000-\u001f\u007f]/u.test(name) ||
    /[\u202a-\u202e\u2066-\u2069]/u.test(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    /^[A-Za-z]:/u.test(name) ||
    !/\.xlsx$/iu.test(name)
  ) {
    return false;
  }
  return true;
}

export async function validateAllianceXlsx(file: AllianceUploadFile): Promise<void> {
  if (!isSafeXlsxFilename(file.originalname) || file.mimetype !== XLSX_MIME || !Buffer.isBuffer(file.buffer))
    return invalid();
  if (
    file.buffer.length < 1 ||
    file.buffer.length > XLSX_MAX_BYTES ||
    (file.size !== undefined && file.size !== file.buffer.length)
  )
    return invalid();
  if (file.buffer.length < 4 || !file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    return invalid();
  await validateBuffer(file.buffer);
}

export async function validateAllianceXlsxBuffer(buffer: Buffer): Promise<void> {
  if (!Buffer.isBuffer(buffer)) return invalid();
  await validateBuffer(buffer);
}

export const validateXlsxUpload = validateAllianceXlsx;
