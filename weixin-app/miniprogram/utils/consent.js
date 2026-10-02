function ensure(page) {
  if (page.data.agreed) return true;
  page.setData({ consentOpen: true });
  return false;
}
const methods = {
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },
  openAgreement(e) {
    wx.navigateTo({
      url: "/pages/agreement/index?type=" + e.currentTarget.dataset.type,
    });
  },
  confirmConsent() {
    this.setData({ agreed: true, consentOpen: false });
  },
  cancelConsent() {
    this.setData({ consentOpen: false });
  },
  consentNoop() {},
};
module.exports = { ensure, methods };
