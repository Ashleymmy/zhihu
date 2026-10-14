const request = require('./request');
const fallback = '/images/avatar.png';
const cache = new Map();
const MAX_BYTES = 256 * 1024;
function remove(path) { try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_) {} }
function clear() {
  for (const item of cache.values()) remove(item.path); cache.clear();
  try {
    const dir = wx.env.USER_DATA_PATH;
    wx.getFileSystemManager().readdir({dirPath:dir,success(result) {
      for(const name of result.files || []) if(/^timo-avatar-[0-9]+-[a-f0-9]{64}\.(png|jpg)$/.test(name)) remove(dir + '/' + name);
    },fail() {}});
  } catch (_) {}
}
const invoke = (method, args) => new Promise((resolve, reject) => method({ ...args, success: resolve, fail: reject }));
async function display(user, guard = () => true) {
  if (!user || !user.avatarVersion || !guard()) return fallback;
  const key = String(user.id), old = cache.get(key);
  if (old && old.version === user.avatarVersion) {
    try { await invoke(wx.getFileSystemManager().access.bind(wx.getFileSystemManager()), { path: old.path }); return guard() ? old.path : fallback; } catch (_) {}
  }
  const file = await request.get('/core/auth/avatar');
  if (!guard() || !file || !file.base64) return fallback;
  const path = wx.env.USER_DATA_PATH + '/timo-avatar-' + key + '-' + file.avatarVersion + (file.mimeType === 'image/png' ? '.png' : '.jpg');
  const fs = wx.getFileSystemManager();
  await invoke(fs.writeFile.bind(fs), { filePath: path, data: file.base64, encoding: 'base64' });
  if (!guard()) { remove(path); return fallback; }
  if (old && old.path !== path) remove(old.path);
  cache.set(key, { version: file.avatarVersion, path });
  return path;
}
async function readChosen(path, guard) {
  const fs = wx.getFileSystemManager();
  let file = await invoke(fs.readFile.bind(fs), { filePath: path });
  if (!guard()) throw new Error('登录已变化，请重新选择头像');
  if (file.data.byteLength > MAX_BYTES) {
    const compressed = await invoke(wx.compressImage, { src: path, quality: 65, compressedWidth: 320 });
    if (!guard()) throw new Error('登录已变化，请重新选择头像');
    file = await invoke(fs.readFile.bind(fs), { filePath: compressed.tempFilePath });
  }
  if (!guard()) throw new Error('登录已变化，请重新选择头像');
  if (!file.data.byteLength || file.data.byteLength > MAX_BYTES) throw new Error('头像过大，请重新选择较小的图片');
  return wx.arrayBufferToBase64(file.data);
}
module.exports = { display, readChosen, clear, fallback };
