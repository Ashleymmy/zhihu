const MAX_BYTES = 700 * 1024;
function read(filePath) {
  return new Promise((resolve, reject) =>
    wx
      .getFileSystemManager()
      .readFile({
        filePath,
        success: (result) => resolve(result.data),
        fail: reject,
      }),
  );
}
async function encode(filePath, guard) {
  let path = filePath;
  let content = await read(path);
  if (!guard()) throw new Error("页面已变化，请重新选择截图");
  // Keep the image within the existing 1 MB signed cloud envelope.
  for (const quality of [70, 40, 20]) {
    if (content.byteLength <= MAX_BYTES) break;
    const compressed = await new Promise((resolve, reject) =>
      wx.compressImage({
        src: filePath,
        quality,
        compressedWidth: 1440,
        success: resolve,
        fail: reject,
      }),
    );
    if (!guard()) throw new Error("页面已变化，请重新选择截图");
    path = compressed.tempFilePath;
    content = await read(path);
  }
  if (!content.byteLength) throw new Error("截图内容为空，请重新选择");
  if (content.byteLength > MAX_BYTES)
    throw new Error("截图过大，请裁剪到举报内容后重新选择");
  if (!guard()) throw new Error("页面已变化，请重新选择截图");
  return { path, base64: wx.arrayBufferToBase64(content) };
}
module.exports = { encode };
