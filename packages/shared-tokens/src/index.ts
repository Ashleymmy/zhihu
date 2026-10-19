// Design Tokens - TypeScript exports

export const colors = {
  paper: '#faf9f5',
  paperDeep: '#f3f1ea',
  ink: '#141413',
  inkSoft: '#5e5d59',
  line: '#e8e6dc',
  forest: '#2b2b29',
  forestDeep: '#3d3d3a',
  moss: '#6f6e68',
  clay: '#d46b45',
  sun: '#a86a12',
  white: '#ffffff',
} as const;

export const fonts = {
  sans: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'Noto Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif",
  display: "'TIMO Serif', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif",
  mono: "'SF Mono', 'JetBrains Mono', Consolas, monospace",
} as const;

export const radius = {
  default: '10px',
} as const;

export const shadows = {
  default: '0 1px 2px rgba(20, 20, 19, 0.04), 0 8px 24px rgba(20, 20, 19, 0.05)',
} as const;

export const breakpoints = {
  mobile: 700,
  tablet: 950,
} as const;
