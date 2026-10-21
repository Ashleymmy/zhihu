const screen = require('../../utils/screen');
const request = require('../../utils/request');
const qr = require('../../utils/business-qr');
const feedback = require('../../utils/feedback');
const invoke = (fn, args = {}) => new Promise((resolve, reject) => fn({ ...args, success: resolve, fail: reject }));
Page(screen('business', {
  scoped: false,
  data: { settings: null, contacts: [], channel: '', contact: null, imagePath: '', imageError: '', saving: false, albumDenied: false },
  async fetch() {
    const version = this._loadVersion;
    this.setData({ settings: null, imagePath: '', contact: null });
    const settings = await request.get('/core/support');
    const contacts = (settings.businessQrCodes || []).filter(item => ['wechat', 'feishu'].includes(item.channel))
      .map(item => ({ ...item, label: item.channel === 'wechat' ? '微信' : '飞书' }))
      .sort((a, b) => (a.channel === 'wechat' ? -1 : b.channel === 'wechat' ? 1 : 0));
    const contact = contacts.find(item => item.channel === this.data.channel) || contacts[0] || null;
    let imagePath = '', imageError = '';
    if (contact) {
      try { imagePath = await qr.display(contact, () => version === this._loadVersion && this.canAct()); }
      catch (_) { imageError = '二维码暂时未能加载，请重试。'; }
    }
    return { settings, contacts, contact, channel: contact?.channel || '', imagePath, imageError };
  },
  changeChannel(e) {
    const channel = e.currentTarget.dataset.channel;
    if (this.data.saving || this.data.loading || !this.canAct() || !this.data.contacts.some(item => item.channel === channel)) return;
    this.setData({ channel, imagePath: '', imageError: '', albumDenied: false });
    return this.load();
  },
  preview() {
    if (this.canAct() && !this.data.loading && this.data.imagePath)
      wx.previewImage({ current: this.data.imagePath, urls: [this.data.imagePath], fail: () => feedback.fail('图片暂时无法打开，请重试') });
  },
  imageFailed() { qr.discard(this.data.imagePath); this.setData({ imagePath: '', imageError: '二维码暂时未能显示，请重试。' }); },
  async saveQr() {
    if (!this.canAct() || this.data.saving || this.data.loading || !this.data.imagePath) return;
    const path = this.data.imagePath, token = wx.getStorageSync('zk_access_token');
    this.setData({ saving: true, albumDenied: false, error: '' });
    try {
      if (wx.requirePrivacyAuthorize) await invoke(wx.requirePrivacyAuthorize);
      if (token !== wx.getStorageSync('zk_access_token')) return;
      await invoke(wx.saveImageToPhotosAlbum, { filePath: path });
      if (!this._hidden) feedback.success('二维码已保存');
    } catch (error) {
      if (!this._hidden) {
        const denied = /auth deny|auth denied|authorize.*denied/i.test(error.errMsg || '');
        this.setData({ albumDenied: denied, error: denied ? '保存需要相册权限，也可以点击二维码查看原图。' : '图片尚未保存，可重试或点击二维码查看原图。' });
      }
    } finally { this.setData({ saving: false }); }
  },
  albumSettings() {
    if (!this.canAct()) return;
    wx.openSetting({ success: result => { if (result.authSetting['scope.writePhotosAlbum']) this.setData({ albumDenied: false, error: '', notice: '已允许保存，请再次点击“保存二维码”' }); } });
  },
  copyBusiness() { if (this.canAct() && this.data.settings?.businessUrl) wx.setClipboardData({ data: this.data.settings.businessUrl }); },
  toSupport() { wx.redirectTo({ url: '/pages/support/index' }); },
}));
