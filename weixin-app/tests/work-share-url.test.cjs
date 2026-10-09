const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, scoped } = require('./harness.cjs');

const url = 'https://v.douyin.com/d45X6VWyzKc/';
const share = url + ' 05/23 :0pm eoQ:/ G@I.Vl';
const row = { url: share, mediaAccount: '发布账号', platformIndex: 2, publishDate: '2026-10-09', workTypeIndex: 1, contentTypeIndex: 0 };
const word = { id: '1', planId: '8', bindingId: '11', executorId: '3', lifecycleStatus: 'assigned', releaseStatus: 'none', syncStatus: 'synced', usageReady: 1 };
function setup(items = [word]) {
  const h = harness(call => scoped(call) ?? (call.path.endsWith('/attribution-options')
    ? { tasks: [], mappings: [], users: [] }
    : { list: items, total: items.length }));
  h.session({ id: '3', role: 'creator' });
  return h;
}
const event = (value, dataset = {}) => ({ detail: { value }, currentTarget: { dataset } });
const writes = h => h.calls.filter(call => ['POST', 'PATCH'].includes(call.method));

test('share text yields the intact case-sensitive work URL without prose or dates', () => {
  const c = harness().load('utils/composition');
  for (const value of [share, '复制打开抖音，看看这个作品：' + share, '\n“' + url + '”；\n打开抖音', '(' + url + ')']) {
    assert.equal(c.extractUrl(value), url);
    assert.equal(c.input('8', { ...row, url: value }).promoUrl, url);
  }
  assert.equal(c.extractUrl('作品介绍'.repeat(800) + '\n' + share), url);
});

test('existing links retain paths, query signatures and fragments for every media platform', () => {
  const c = harness().load('utils/composition');
  for (const value of [
    url,
    'https://www.xiaohongshu.com/explore/abc?xsec_token=AbC%2F123%3D&xsec_source=pc_share#note',
    'https://xhslink.com/o/4ABC?source=share',
    'https://v.kuaishou.com/ZJsAbC/',
    'https://www.bilibili.com/video/BV1AbC/?share_source=copy_web',
    'https://mp.weixin.qq.com/s?__biz=abc&mid=123&idx=1&sn=AbC',
    'https://example.com/work_(part_1)?next=https://example.com/next',
  ]) {
    assert.equal(c.input('8', { ...row, url: '分享作品：' + value + ' 打开查看' }).promoUrl, value);
  }
});

test('missing, ambiguous and oversized URLs are not silently registered', () => {
  const c = harness().load('utils/composition');
  for (const value of ['', '只有文案没有链接', 'https://', 'javascript:alert(1)', 'https://user:pass@example.com/work']) {
    assert.throws(() => c.input('8', { ...row, url: value }), /链接/);
  }
  const two = share + '\nhttps://v.douyin.com/Other/';
  assert.equal(c.extractUrl(two), two);
  assert.throws(() => c.input('8', { ...row, url: two }), /多个链接/);
  assert.throws(() => c.input('8', { ...row, url: 'https://example.com/' + 'a'.repeat(1024) }), /链接过长/);
});

test('single registration sends only the extracted link even without a blur event', async () => {
  const h = setup(), p = h.page('keywords');
  await p.onShow();
  p.choose(event(null, { index: 0, action: 'work' }));
  p.setData({ workUrl: share, mediaAccount: row.mediaAccount, platformIndex: row.platformIndex, publishDate: row.publishDate, workTypeIndex: row.workTypeIndex, contentTypeIndex: row.contentTypeIndex });
  await p.runAction();
  assert.equal(writes(h).length, 1);
  assert.equal(writes(h)[0].path, '/modules/zhihu/mini-works');
  assert.equal(writes(h)[0].data.promoUrl, url);
  assert.equal(writes(h)[0].data.planId, '8');
});

test('batch registration extracts each row and validates all rows before sending any', async () => {
  const h = setup(), p = h.page('keywords');
  await p.onShow();
  p.choose(event(null, { index: 0, action: 'work' }));
  p.setData({ batchMode: true, batchItems: [row, { ...row, url: share + ' https://v.douyin.com/Other/' }] });
  await p.runAction();
  assert.equal(writes(h).length, 0);
  assert.match(p.data.error, /多个链接/);
  p.setData({ batchItems: [row, { ...row, url: '打开快手：https://v.kuaishou.com/AbC/ 查看作品', platformIndex: 3 }] });
  await p.runAction();
  assert.deepEqual(writes(h).map(call => call.data.promoUrl), [url, 'https://v.kuaishou.com/AbC/']);
});

test('editing an existing work submits the clean link while retaining its other fields', async () => {
  const h = setup([{ id: 'composition:9', compositionId: '9', planId: '8', canEdit: true, mediaAccount: row.mediaAccount, mediaType: 'KOC抖音', compositionType: 2, compositionSubType: 5, releaseTime: '2026-10-09T04:30:00.000Z', description: '保留标题' }]);
  const p = h.page('works');
  await p.onShow();
  p.choose(event(null, { index: 0 }));
  p.editInput(event(share, { field: 'url' }));
  await p.save();
  assert.equal(writes(h).length, 1);
  const call = writes(h)[0];
  assert.equal(call.method, 'PATCH');
  assert.equal(call.path, '/modules/zhihu/compositions/9');
  assert.equal(call.data.promoUrl, url);
  assert.equal(call.data.mediaAccount, row.mediaAccount);
  assert.equal(call.data.title, '保留标题');
  assert.equal(call.data.releaseTime, '2026-10-09T04:30:00.000Z');
});

test('leaving each link field shows the extracted URL and preserves neighboring rows', () => {
  const h = setup(), p = h.page('keywords');
  p.normalizeWorkUrl(event(share));
  assert.equal(p.data.workUrl, url);
  p.setData({ batchItems: [row, { ...row, url: 'https://example.com/keep' }] });
  p.normalizeWorkUrl(event(share, { index: 0 }));
  assert.equal(p.data.batchItems[0].url, url);
  assert.equal(p.data.batchItems[0].mediaAccount, row.mediaAccount);
  assert.equal(p.data.batchItems[1].url, 'https://example.com/keep');
  const w = h.page('works');
  w.normalizeWorkUrl(event(share));
  assert.equal(w.data.form.url, url);
});
