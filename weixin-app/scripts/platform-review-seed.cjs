// Called only with the port returned by platform-review-host's disposable DB.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async function seed(port) {
  assert(Number.isInteger(port) && port > 0);
  const base = 'http://127.0.0.1:' + port + '/api/v1';
  let token = '';
  async function api(route, data, multipart = false) {
    const response = await fetch(base + route, { method: data ? 'POST' : 'GET',
      headers: { 'X-Client-Id': 'isolated-mini-seed', 'User-Agent': 'isolated-review',
        ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(!multipart ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: multipart ? data : JSON.stringify(data) } : {}) });
    const body = await response.json(); assert(response.ok, route + ': ' + JSON.stringify(body)); return body.data;
  }
  token = (await api('/core/auth/login', { username: 'admin', password: 'Admin123456!' })).token;
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const scope = { projectId: '1', accountId: '1' };
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...scope, reportType: 'activation' })) form.set(key, value);
  form.set('file', new Blob([`日期,渠道名称,关键词,拉活量\n${date},知乎故事一代渠道,重生千金,4`], { type: 'text/csv' }), 'isolated-activation.csv');
  await api('/modules/zhihu/workbench/import', form, true);
  const query = new URLSearchParams({ ...scope, from: date, to: date, viewVersion: '2' });
  const bills = await api('/modules/zhihu/workbench?' + query);
  const confirmed = await api('/modules/zhihu/workbench/confirm', { ...scope, from: date, to: date, viewVersion: '2', reviewHash: bills.reviewHash, acknowledged: true, requestKey: randomUUID() });
  const financeScope = { ...scope, moduleId: 'zhihu' };
  const finance = await api('/core/finance?' + new URLSearchParams(financeScope));
  await api('/core/finance/funding', { ...financeScope, hash: finance.funding.hash, reference: '本机小程序隔离验收资金' });
  await api('/core/auth/logout', {});
  return { date, confirmed, funding: finance.funding.amount };
};
if (require.main === module) {
  const fs = require('node:fs'), path = require('node:path');
  const work = path.resolve(__dirname, '../../.opc-work/p2-mini-ui');
  const session = JSON.parse(fs.readFileSync(path.join(work, 'session.json')));
  assert.equal(session.mode, 'zhihu');
  module.exports(session.port).then(result => {
    fs.writeFileSync(path.join(work, 'seed.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
