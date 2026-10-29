const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { harness } = require("./harness.cjs");
for (const role of ["creator", "leader", "operator", "admin", "developer"])
  test(
    "support is available to " + role + " without project permissions",
    async () => {
      const user = { id: "1", userId: "timo000001", role },
        settings = {
          miniContactEnabled: true,
          serviceUrl: "https://applink.feishu.cn/example",
          businessUrl: "",
          serviceHours: "",
        };
      const h = harness((c) => {
        if (c.path === "/core/auth/me") return user;
        if (c.path === "/core/support") return settings;
        throw Error("Unexpected " + c.path);
      });
      h.session(user);
      const page = h.page("support");
      await page.onShow();
      assert.equal(page.data.allowed, true);
      assert.equal(page.data.settings.miniContactEnabled, true);
      assert.equal(
        h.calls.some((c) => c.path.startsWith("/core/projects")),
        false,
      );
    },
  );
test("customer chat uses WeChat native contact and does not disclose account details in its source", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../miniprogram/pages/support/index.wxml"),
    "utf8",
  );
  assert.match(source, /open-type="contact"/);
  assert.match(source, /wx:if="{{settings.miniContactEnabled}}"/);
  assert.match(source, /session-from="support-page"/);
});

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
function businessSetup() {
  const user = { id: '3', userId: 'timo000003', role: 'creator' };
  let settings = { businessUrl: '', serviceHours: '工作日', businessQrCodes: [
    { channel: 'wechat', name: '微信商务', version: 'a'.repeat(64), mimeType: 'image/png' },
    { channel: 'feishu', name: '飞书商务', version: 'b'.repeat(64), mimeType: 'image/png' },
  ] };
  const h = harness(c => {
    if (c.path === '/core/auth/me') return user;
    if (c.path === '/core/support') return settings;
    if (c.path.startsWith('/core/support/business-qrcodes/')) return { ...settings.businessQrCodes.find(q => q.channel === c.path.split('/').pop()), base64: png };
    throw Error('Unexpected ' + c.path);
  });
  h.session(user);
  return { h, page: h.page('business'), change: value => { settings = { ...settings, ...value }; } };
}
test('我的页商务入口直达卡片，微信飞书切换使用对应原图，更新和移除不会继续展示旧码', async () => {
  const { h, page, change } = businessSetup();
  const mine = h.page('mine'); await mine.onShow();
  const entry = mine.data.menus.find(item => item.key === 'business'); assert(entry);
  mine.open({ currentTarget: { dataset: { path: entry.path } } });
  assert.equal(h.navigation.at(-1), '/pages/business/index');
  await page.onShow(); assert.equal(page.data.channel, 'wechat'); assert.equal(page.data.contact.name, '微信商务');
  assert.equal(h.files.get(page.data.imagePath).toString('base64'), png);
  let preview; h.wx.previewImage = value => { preview = value; }; page.preview(); assert.equal(preview.current, page.data.imagePath);
  await page.changeChannel({ currentTarget: { dataset: { channel: 'feishu' } } }); assert.equal(page.data.contact.name, '飞书商务');
  const oldPath = page.data.imagePath;
  change({ businessQrCodes: [{ channel: 'feishu', name: '新联系人', version: 'c'.repeat(64), mimeType: 'image/png' }] });
  await page.load(); assert.equal(page.data.contact.name, '新联系人'); assert.notEqual(page.data.imagePath, oldPath); assert.equal(h.files.has(oldPath), false);
  change({ businessQrCodes: [] }); await page.load(); assert.equal(page.data.imagePath, ''); assert.equal(page.data.contact, null);
});
test('保存二维码仅点击触发，原图不裁切；拒绝相册权限后仍可预览及打开设置', async () => {
  const { h, page } = businessSetup(); let saved = 0, previewed = 0, privacy = 0;
  h.wx.requirePrivacyAuthorize = o => { privacy++; o.success({}); };
  h.wx.saveImageToPhotosAlbum = o => { saved++; o.success({}); };
  h.wx.previewImage = () => { previewed++; };
  await page.onShow(); assert.equal(privacy, 0); assert.equal(saved, 0);
  await page.saveQr(); assert.equal(saved, 1); assert.equal(privacy, 1);
  h.wx.saveImageToPhotosAlbum = o => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' });
  await page.saveQr(); assert.equal(page.data.albumDenied, true);
  page.preview(); assert.equal(previewed, 1);
  h.wx.openSetting = o => o.success({ authSetting: { 'scope.writePhotosAlbum': true } });
  page.albumSettings(); assert.equal(page.data.albumDenied, false);
});
test('旧设置仅有飞书链接时仍可使用，无二维码时不弹相册授权', async () => {
  const { h, page, change } = businessSetup(); change({ businessQrCodes: undefined, businessUrl: 'https://applink.feishu.cn/example' });
  let copied = ''; h.wx.setClipboardData = o => { copied = o.data; };
  await page.onShow(); assert.equal(page.data.contact, null); await page.saveQr();
  page.copyBusiness(); assert.equal(copied, 'https://applink.feishu.cn/example');
});
test('迟到的二维码响应不能在离开页面后写入新会话', async () => {
  const { deferred } = require('./harness.cjs'), pending = deferred();
  const user = { id: '3', role: 'creator' }, item = { channel: 'wechat', version: 'a'.repeat(64), mimeType: 'image/png', name: '商务' };
  const h = harness(c => c.path === '/core/auth/me' ? user : c.path === '/core/support' ? { businessQrCodes: [item] } : pending.promise);
  h.session(user); const page = h.page('business'), loading = page.onShow();
  await new Promise(r => setImmediate(r)); page.onHide(); h.session({ id: '4', role: 'creator' }, 'other-session');
  pending.resolve({ ...item, base64: png }); await loading;
  assert.equal(page.data.imagePath, ''); assert.equal(h.files.size, 0);
});
