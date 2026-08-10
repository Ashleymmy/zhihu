const snakeToCamel = (key: string) => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());

export function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [snakeToCamel(key), serialize(child)]),
    );
  }
  return value;
}
