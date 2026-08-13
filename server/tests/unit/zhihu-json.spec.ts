import { parseZhihuJson } from '../../src/zhihu/json';

describe('知乎 JSON 大整数解析', () => {
  it('将未加引号的超大整数保留为精确字符串', () => {
    expect(parseZhihuJson('{"data":{"plan_id":2071265453767405652,"negative":-2071265453767405652}}'))
      .toEqual({ data: { plan_id: '2071265453767405652', negative: '-2071265453767405652' } });
  });

  it('不修改字符串内容、安全整数、小数或科学计数法', () => {
    expect(parseZhihuJson('{"text":"id 2071265453767405652","count":42,"ratio":1.25,"exp":1e20}'))
      .toEqual({ text: 'id 2071265453767405652', count: 42, ratio: 1.25, exp: 1e20 });
  });

  it('非 JSON 响应保持原文', () => {
    expect(parseZhihuJson('upstream unavailable')).toBe('upstream unavailable');
  });
});
