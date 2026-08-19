// Design Tokens - TypeScript exports

export const colors = {
  paper: '#f4f1e9',
  paperDeep: '#e8e3d8',
  ink: '#202923',
  inkSoft: '#59645d',
  line: '#d6d1c6',
  forest: '#214239',
  forestDeep: '#17352e',
  moss: '#6c8c72',
  clay: '#c96249',
  sun: '#d4a847',
  white: '#fffdf8',
} as const;

export const fonts = {
  sans: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif',
  display: '"Noto Serif SC", "DM Serif Display", serif',
  mono: '"DM Mono", monospace',
} as const;

export const radius = {
  default: '8px',
} as const;

export const shadows = {
  default: '4px 4px 0 rgba(32, 41, 35, 0.13)',
} as const;

export const breakpoints = {
  mobile: 700,
  tablet: 950,
} as const;
