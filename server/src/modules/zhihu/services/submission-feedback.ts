// Explain a known input problem at the field the user can change. Unknown URL
// hosts remain allowed: this is not a platform allowlist or a network crawler.
export function compositionLinkProblem(mediaType: string, url: string): string | null {
  let host: string;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid URL');
    host = parsed.hostname.toLowerCase();
  } catch { return '请填写完整的作品链接（以 https:// 或 http:// 开头）'; }
  const matches = (domain: string) => host === domain || host.endsWith('.' + domain);
  const actual = matches('tiktok.com') ? 'TikTok'
    : ['douyin.com','iesdouyin.com'].some(matches) ? '抖音'
    : ['xiaohongshu.com','xhslink.com','xhslink.cn'].some(matches) ? '小红书'
    : matches('kuaishou.com') || matches('gifshow.com') ? '快手'
    : matches('bilibili.com') || matches('b23.tv') ? '哔哩哔哩'
    : matches('weibo.com') || matches('weibo.cn') ? '微博' : null;
  const chosen = mediaType.replace(/^KOC/, '');
  return actual && chosen !== '定向' && actual !== chosen
    ? `发布平台与作品链接不一致：选择了“${chosen}”，链接来自“${actual}”。请修改发布平台或作品链接。` : null;
}

export function submissionFailure(error: unknown, kind: 'keyword' | 'composition'): string {
  const text = String(error ?? '');
  const business = text.match(/：知乎返回：(.+)$/)?.[1];
  if (business) return `知乎返回：${business}`;
  if (/400402.*：关键词不符合知乎规则/.test(text)) return '知乎拒绝了此次提交（400402）。旧版提示未保留具体原因，请检查填写信息后重新提交。';
  if (/作品链接.*(绑定|重复)/.test(text)) return '该作品链接已在知乎登记。请先检查已有记录；若填错链接，可修改后重新提交。';
  if (/内容链接|内容URL/.test(text)) return '推广内容链接不正确，请检查链接后重新提交。';
  if (/渠道.*(无效|不存在)/.test(text)) return '所选渠道不可用，请重新选择渠道后提交。';
  if (/关键词.*(规则|词根|更换|存在|绑定)/.test(text)) return text.replace(/^.*：/, '').slice(0,300);
  if (/发布时间.*缺失/.test(text)) return '请补充作品发布时间后重新提交。';
  if (/推广计划尚未同步/.test(text)) return '此关键词尚未创建成功，请先处理关键词，再重新提交作品。';
  if (/配额|次数已达/.test(text)) return '知乎操作次数已达上限，请稍后重试。';
  const code = text.match(/code (\d+)/)?.[1];
  return code ? `知乎拒绝了此次提交（${code}），未返回可识别的具体原因。填写信息已保留，可修改后重新提交。`
    : `${kind === 'keyword' ? '关键词' : '作品'}暂未提交成功，填写信息已保留，请稍后重试。`;
}
