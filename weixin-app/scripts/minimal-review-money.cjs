// Disposable API only. Exercise the existing mini-program withdrawal workflow;
// the system file picker is replaced, while file upload and all business APIs run.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const session = JSON.parse(fs.readFileSync(path.join(root, '.opc-work/p2-mini-ui/session.json')));
const seed = JSON.parse(fs.readFileSync(path.join(root, '.opc-work/p2-mini-ui/seed.json')));
assert.equal(session.mode, 'zhihu');
assert.equal(seed.date, new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
assert(fs.readFileSync(path.join(session.project, 'miniprogram/utils/request.js'), 'utf8').includes('http://127.0.0.1:' + session.proxyPort + '/rpc'));
const automator = require(process.env.WECHAT_AUTOMATOR_MODULE || path.join(root, '.runtime/wechat-tools/node_modules/miniprogram-automator'));
const out = path.join(root, '改造/截图_2026-10-09/P2-mini-minimal');
const pause = ms => new Promise(r => setTimeout(r, ms));
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
async function until(read, check, label) { for (let i = 0; i < 100; i++) { const value = await read(); if (check(value)) return value; await pause(200); } throw Error(label + ' timed out'); }
(async () => {
 const m = await automator.connect({ wsEndpoint: session.endpoint });
 async function loaded(p) { const d = await until(() => p.data(), d => !d.loading && !d.busy, 'load'); assert(!d.error, d.error); return d; }
 async function page(route) { await m[['home', 'income', 'mine'].includes(route) ? 'switchTab' : 'navigateTo']('/pages/' + route + '/index'); const p = await until(() => m.currentPage(), p => p.path === 'pages/' + route + '/index', route); await loaded(p); return p; }
 async function login(username) {
  if (await m.evaluate(() => !!getApp().globalData.user)) await (await page('mine')).callMethod('logout');
  await m.reLaunch('/pages/login/index'); const p = await m.currentPage();
  await (await p.$('input[data-name="username"]')).input(username);
  await (await p.$('input[data-name="password"]')).input('Review123456');
  await (await p.$('checkbox-group')).trigger('change', { value: ['agree'] });
  await (await p.$('.login-btn')).tap();
  await until(() => m.currentPage(), p => p.path !== 'pages/login/index', 'login');
  await loaded(await m.currentPage());
 }
 async function shot(name) { await m.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 }); await m.screenshot({ path: path.join(out, name + '.png') }); }
 try {
  const quantities = [];
  for (const [username, price, total] of [['creator_li', '1.2000', '4.80'], ['leader_wang', '0.4000', '1.60']]) {
   await login(username); const p = await page('income');
   await p.callMethod('filter', event({ field: 'metricType', value: 'activation' }));
   const d = await loaded(p); assert.equal(d.records.length, 1);
   assert.equal(String(d.records[0].quantity), '4'); assert.equal(d.records[0].unitPrice, price);
   assert.equal(d.summary.confirmedReceivable, total); assert.equal(d.summary.pendingReceivable, '0.00');
   quantities.push({ role: username === 'creator_li' ? 'creator' : 'leader', quantity: '4', unitPrice: price, confirmed: total });
  }
  await login('creator_li'); let p = await page('withdrawals'), d = await loaded(p);
  const original = d.view.balance; assert.equal(original.available, '164.8000');
  await p.callMethod('openApply');
  for (const [name, value] of Object.entries({ amount: '1.20', receiverName: '隔离验收', bankName: '测试渠道', bankAccount: 'isolated-only-not-a-bank-account' }))
   await (await p.$('input[data-name="form.' + name + '"]')).input(value);
  await p.callMethod('apply'); d = await loaded(p);
  const withdrawal = d.view.withdrawals.find(w => w.receiverName === '隔离验收' && w.status === 'pending'); assert(withdrawal);
  assert.equal(d.view.balance.processing, '1.2000'); await shot('creator-withdrawal-pending');
  await login('review_finance'); p = await page('withdrawals'); d = await loaded(p);
  let index = d.view.withdrawals.findIndex(w => w.id === withdrawal.id); assert(index >= 0);
  await p.callMethod('choose', event({ index, action: 'approve' })); await p.callMethod('review'); d = await loaded(p);
  index = d.view.withdrawals.findIndex(w => w.id === withdrawal.id); assert.equal(d.view.withdrawals[index].status, 'approved');
  await shot('finance-withdrawal-approved'); await p.callMethod('pay', event({ index }));
  const png = fs.readFileSync(path.join(root, 'weixin-app/miniprogram/images/avatar.png'));
  const filePath = await m.evaluate(base64 => { const filePath = wx.env.USER_DATA_PATH + '/isolated-payment-proof.png'; wx.getFileSystemManager().writeFileSync(filePath, base64, 'base64'); return filePath; }, png.toString('base64'));
  await m.mockWxMethod('chooseMessageFile', { tempFiles: [{ path: filePath, name: 'isolated-payment-proof.png', size: png.length, type: 'file' }], errMsg: 'chooseMessageFile:ok' });
  await p.callMethod('uploadProof'); d = await loaded(p); assert(d.proofFileId);
  await m.restoreWxMethod('chooseMessageFile');
  await (await p.$('input[data-name="paymentForm.reference"]')).input('ISOLATED-MINI-' + Date.now());
  await p.callMethod('acknowledgePayment', event({}, ['yes'])); await p.callMethod('recordPayment'); d = await loaded(p);
  assert.equal(d.view.withdrawals.find(w => w.id === withdrawal.id).status, 'paid'); await shot('finance-withdrawal-paid');
  await login('creator_li'); p = await page('withdrawals'); d = await loaded(p);
  assert.equal(d.view.withdrawals.find(w => w.id === withdrawal.id).status, 'paid');
  assert.equal(d.view.balance.paid, '1.2000'); assert.equal(d.view.balance.processing, '0.0000'); assert.equal(d.view.balance.available, '163.6000');
  await shot('creator-withdrawal-paid');
  // Independent Web session reads the same real API after the mobile workflow.
  const base = 'http://127.0.0.1:' + session.port + '/api/v1';
  const headers = { 'Content-Type': 'application/json', 'X-Client-Id': 'isolated-mini-money-web', 'User-Agent': 'isolated-review' };
  let response = await fetch(base + '/core/auth/login', { method: 'POST', headers, body: JSON.stringify({ username: 'review_finance', password: 'Review123456' }) });
  assert(response.ok); const token = (await response.json()).data.token;
  headers.Authorization = 'Bearer ' + token;
  response = await fetch(base + '/core/finance?projectId=1&accountId=1&moduleId=zhihu', { headers }); assert(response.ok);
  const web = (await response.json()).data; assert.equal(web.withdrawals.find(w => w.id === withdrawal.id).status, 'paid');
  await fetch(base + '/core/auth/logout', { method: 'POST', headers, body: '{}' });
  const result = { isolated: true, quantities, withdrawal: { amount: '1.2000', status: 'paid', miniAndWebConsistent: true }, balance: d.view.balance, realFileUpload: true };
  fs.writeFileSync(path.join(out, 'money-result.json'), JSON.stringify(result, null, 2)); console.log('MINIMAL_MONEY_PASSED', JSON.stringify(result));
 } catch (error) { fs.writeFileSync(path.join(out, 'money-failure.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2)); await m.screenshot({ path: path.join(out, 'money-failure.png') }); throw error; }
 finally { await m.restoreWxMethod('chooseMessageFile').catch(() => {}); m.disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
