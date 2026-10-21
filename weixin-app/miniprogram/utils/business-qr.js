const request = require('./request');
const invoke = (method, args) => new Promise((resolve, reject) => method({ ...args, success: resolve, fail: reject }));
function remove(filePath) { try { wx.getFileSystemManager().unlink({ filePath, fail() {} }); } catch (_) {} }
async function display(item, guard) {
  if (!guard()) return '';
  if (!['wechat', 'feishu'].includes(item.channel) || !/^[a-f0-9]{64}$/.test(item.version)) throw new Error('联系方式已更新，请刷新后查看');
  const fs = wx.getFileSystemManager(), prefix = 'timo-business-' + item.channel + '-';
  const path = wx.env.USER_DATA_PATH + '/' + prefix + item.version + (item.mimeType === 'image/png' ? '.png' : '.jpg');
  try { await invoke(fs.access.bind(fs), { path }); if (guard()) return path; return ''; } catch (_) {}
  const image = await request.get('/core/support/business-qrcodes/' + item.channel);
  if (!guard()) return '';
  if (image.version !== item.version || !['image/png', 'image/jpeg'].includes(image.mimeType) || image.mimeType !== item.mimeType || !image.base64 || image.base64.length > 349528)
    throw new Error('联系方式已更新，请刷新后查看');
  await invoke(fs.writeFile.bind(fs), { filePath: path, data: image.base64, encoding: 'base64' });
  if (!guard()) { remove(path); return ''; }
  // Only two platform contact images are cached; retire replaced versions.
  fs.readdir({ dirPath: wx.env.USER_DATA_PATH, success({ files }) {
    if (!guard()) return;
    for (const name of files || []) if (name.startsWith(prefix) && /^timo-business-(wechat|feishu)-[a-f0-9]{64}\.(png|jpg)$/.test(name) && wx.env.USER_DATA_PATH + '/' + name !== path) remove(wx.env.USER_DATA_PATH + '/' + name);
  }, fail() {} });
  return path;
}
function discard(path) { if (typeof path === 'string' && path.startsWith(wx.env.USER_DATA_PATH + '/timo-business-')) remove(path); }
module.exports = { display, discard };
