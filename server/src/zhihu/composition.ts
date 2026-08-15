import { AppError } from '../middleware/errors';

export const ZHIHU_MEDIA_TYPES = [
  'KOC视频号',
  'KOC百家号',
  'KOC抖音',
  'KOC快手',
  'KOC微博',
  'KOC小红书',
  'KOC定向',
  'KOC头条号',
  'KOC哔哩哔哩',
  'KOC公众号',
] as const;

export type ZhihuMediaType = (typeof ZHIHU_MEDIA_TYPES)[number];

export const COMPOSITION_TYPES = [
  { value: 0, label: '其他' },
  { value: 1, label: '图文' },
  { value: 2, label: '视频' },
] as const;

export const COMPOSITION_SUB_TYPES = [
  { value: 11, label: '其他', parent: 0 },
  { value: 1, label: '实拍', parent: 1 },
  { value: 2, label: 'Live 图', parent: 1 },
  { value: 3, label: '截屏', parent: 1 },
  { value: 4, label: '漫画', parent: 1 },
  { value: 5, label: '表情包解说', parent: 2 },
  { value: 6, label: '真人演绎', parent: 2 },
  { value: 7, label: '猫 meme', parent: 2 },
  { value: 8, label: '漫剧', parent: 2 },
  { value: 9, label: '解压', parent: 2 },
  { value: 10, label: '滚屏', parent: 2 },
] as const;

const legacyMediaTypes: Record<number, ZhihuMediaType> = {
  1: 'KOC抖音',
  2: 'KOC小红书',
};

export function normalizeMediaType(value: string | number): ZhihuMediaType {
  if (typeof value === 'number' && legacyMediaTypes[value]) return legacyMediaTypes[value];
  if (typeof value === 'string' && ZHIHU_MEDIA_TYPES.includes(value as ZhihuMediaType)) {
    return value as ZhihuMediaType;
  }
  throw new AppError(422, 42200, '媒体类型不正确');
}

export function isCompositionCategoryValid(type: number, subType: number): boolean {
  return COMPOSITION_SUB_TYPES.some((item) => item.parent === type && item.value === subType);
}

export function isZonedIsoDateTime(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(normalizeZonedIsoDateTime(value)));
}

export function normalizeZonedIsoDateTime(value: string): string {
  return value.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/i, '$1');
}
