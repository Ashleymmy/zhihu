const { extractUrl } = require('./composition');
const { publicUrl } = require('./actions');

function extract(value, optional = false) {
  const text = String(value || '').trim();
  if (!text && optional) return '';
  if ((text.match(/https?:\/\//gi) || []).length > 1)
    throw new Error('检测到多个链接，请只保留一篇小说的分享链接');
  const url = extractUrl(text);
  if (!publicUrl(url)) throw new Error('请粘贴包含 http:// 或 https:// 链接的小说分享文本');
  // Keep opaque tokens and percent escapes byte-for-byte. Never slice, decode,
  // re-encode, or replace an unresolvable share URL with a guessed destination.
  return url;
}

function prepare(value, optional = false) {
  const url = extract(value, optional);
  if (url.length > 1024)
    throw new Error('链接超过 1024 个字符，已保留完整输入。请重新获取小说分享链接');
  if (url.length === 140 && /^https?:\/\/(?:soia|oia)\.zhihu\.com\/km_paid_content\/share\?/i.test(url)
      && !/[?&]mst=[^&#\s]+/.test(url))
    throw new Error('这条分享链接已缺失内容，请从知乎重新复制后点击“粘贴链接”');
  return url;
}

async function paste(page, isCurrent, apply) {
  if (page.data.busy || page.data.linkPasting || page.data.loading || !page.canAct()) return;
  const context = page._context, version = page._loadVersion;
  const current = () => page._context === context && page._loadVersion === version
    && page.canAct() && !page.data.busy && isCurrent();
  page.setData({ linkPasting: true, error: '', notice: '' });
  try {
    const result = await new Promise((resolve, reject) => wx.getClipboardData({ success: resolve, fail: reject }));
    if (!current()) return;
    // Even an overlong URL stays intact in the field; submission explains the
    // limit instead of turning a long URL into a different, broken short URL.
    apply(extract(result.data));
  } catch (error) {
    if (current()) page.setData({ error: error.message || '未能读取剪贴板，请长按输入框粘贴；原内容已保留' });
  } finally {
    page.setData({ linkPasting: false });
  }
}

module.exports = { extract, prepare, paste };
