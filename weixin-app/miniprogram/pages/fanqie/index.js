const QR_IMAGE = "/images/projects/fanqie-guide.jpg";
Page({
  data: { qrImage: QR_IMAGE },
  preview() {
    wx.previewImage({ current: QR_IMAGE, urls: [QR_IMAGE] });
  },
  home() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
