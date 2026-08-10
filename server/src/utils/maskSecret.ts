export const maskSecret = (value: string) => `****${value.slice(-4)}`;

export function maskName(value: string): string {
  if (value.length <= 1) return `${value}**`;
  if (value.length === 2) return `${value[0]}**`;
  return `${value[0]}**${value[value.length - 1]}`;
}

export function maskAccount(value: string): string {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
