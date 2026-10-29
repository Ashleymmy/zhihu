const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const tls = require('node:tls');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const trust = require('../cloudfunctions/opc-bridge/tls-trust');
const bad = new Set([
  '86A1ECBA089C4A8D3BBE2734C612BA341D813E043CF9E8A862CD5C57A36BBE6B',
  'D7A7A0FB5D7E2731D771E9484EBCDEF71D5F0C3E0A2948782BC83EE0EA699EF4',
]);
const fingerprint = pem => new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '');
test('trust removes compromised roots and preserves every unrelated root', () => {
  assert.ok(trust.ca.length > 100);
  assert.ok(trust.ca.every(pem => !bad.has(fingerprint(pem))));
  assert.deepEqual(trust.ca, tls.rootCertificates.filter(pem => !bad.has(fingerprint(pem))));
  assert.throws(() => trust.safeRoots([]), /No trusted/);
  assert.throws(() => trust.safeRoots(['invalid certificate']));
});
test('bridge agent and SDK default agent retain certificate verification', () => {
  const original = { ...https.globalAgent.options };
  try {
    trust.installSdkTrust();
    assert.equal(https.globalAgent.options.ca, trust.ca);
    assert.equal(https.globalAgent.options.rejectUnauthorized, true);
    assert.equal(trust.agent.options.ca, trust.ca);
    assert.equal(trust.agent.options.rejectUnauthorized, true);
  } finally { https.globalAgent.options = original; }
});
test('disabled TLS validation fails closed before SDK initialization', () => {
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    assert.throws(() => trust.installSdkTrust(), /must remain enabled/);
  } finally {
    if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before;
  }
});
test('cloud bootstrap installs trust before loading SDK and disables custom SDK agents', () => {
  const calls = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/opc-bridge/index'), 'utf8'), {
    process: { env: {} }, exports: {},
    require(name) {
      if (name === './tls-trust') return { installSdkTrust: () => calls.push('trust') };
      if (name === 'wx-server-sdk') { calls.push('sdk'); return { init: options => { assert.equal(options.keepalive, false); calls.push('init'); } }; }
      if (name === './bridge') return { createBridge: () => () => {} };
      throw new Error('unexpected module');
    },
  });
  assert.deepEqual(calls, ['trust', 'sdk', 'init']);
});
