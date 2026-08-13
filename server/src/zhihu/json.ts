const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function quoteUnsafeIntegers(raw: string): string {
  let result = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < raw.length) {
    const char = raw[index];
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      index += 1;
      continue;
    }
    if (char !== '-' && (char < '0' || char > '9')) {
      result += char;
      index += 1;
      continue;
    }

    const start = index;
    if (raw[index] === '-') index += 1;
    while (index < raw.length && raw[index] >= '0' && raw[index] <= '9') index += 1;
    let integerOnly = true;
    if (raw[index] === '.') {
      integerOnly = false;
      index += 1;
      while (index < raw.length && raw[index] >= '0' && raw[index] <= '9') index += 1;
    }
    if (raw[index] === 'e' || raw[index] === 'E') {
      integerOnly = false;
      index += 1;
      if (raw[index] === '+' || raw[index] === '-') index += 1;
      while (index < raw.length && raw[index] >= '0' && raw[index] <= '9') index += 1;
    }
    const token = raw.slice(start, index);
    let unsafe = false;
    if (integerOnly && /^-?\d+$/.test(token)) {
      const value = BigInt(token);
      unsafe = value > MAX_SAFE_INTEGER || value < -MAX_SAFE_INTEGER;
    }
    result += unsafe ? `"${token}"` : token;
  }
  return result;
}

/** 保留知乎 JSON 响应中超出 JavaScript 安全整数范围的 Snowflake ID。 */
export function parseZhihuJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return value;
  try {
    return JSON.parse(quoteUnsafeIntegers(value));
  } catch {
    return value;
  }
}
