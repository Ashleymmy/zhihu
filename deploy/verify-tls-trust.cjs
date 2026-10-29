// No application credentials or HTTP bodies are sent by this TLS-only probe.
const tls = require('node:tls');
const fs = require('node:fs');
const { X509Certificate } = require('node:crypto');
const blocked = new Set([
  '86A1ECBA089C4A8D3BBE2734C612BA341D813E043CF9E8A862CD5C57A36BBE6B',
  'D7A7A0FB5D7E2731D771E9484EBCDEF71D5F0C3E0A2948782BC83EE0EA699EF4',
]);
const certificateErrors = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_UNTRUSTED', 'CERT_REVOKED',
]);
const bridgePath = process.argv.find(arg => arg.startsWith('--bridge-module='))?.split('=').slice(1).join('=');
const bridgeCa = bridgePath ? require(bridgePath).ca : undefined;
function inspectRoots(name, roots) {
  if (!roots.length) throw new Error(`${name}: empty trust store`);
  const unsafe = roots.map(pem => new X509Certificate(pem))
    .filter(cert => blocked.has(cert.fingerprint256.replace(/:/g, '')));
  if (unsafe.length) throw new Error(`${name}: compromised trust path remains`);
  return { store: name, count: roots.length, safe: true };
}
async function probe(host, expectedTrusted) {
  return new Promise(resolve => {
    const socket = tls.connect({ host, servername: host, port: 443, rejectUnauthorized: true, ...(bridgeCa ? { ca: bridgeCa } : {}) });
    const timer = setTimeout(() => socket.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), 15000);
    function finish(trusted, code) {
      clearTimeout(timer); socket.destroy();
      resolve({ host, trusted, code, passed: expectedTrusted ? trusted : !trusted && certificateErrors.has(code) });
    }
    socket.once('secureConnect', () => finish(true, 'OK'));
    socket.once('error', error => finish(false, error.code || 'UNKNOWN'));
  });
}
(async () => {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS validation disabled');
  const stores = [inspectRoots(bridgeCa ? 'bridge' : 'node', bridgeCa || tls.rootCertificates)];
  const bundle = '/etc/ssl/certs/ca-certificates.crt';
  if (!bridgeCa && fs.existsSync(bundle)) stores.push(inspectRoots('system', fs.readFileSync(bundle, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []));
  const results = [];
  if (process.argv.includes('--online')) {
    const bad = ['dv', 'ov', 'ev'].flatMap(type => ['g3b', 'g3c'].flatMap(generation => ['', '-aaa'].map(cross => `${type}-${generation}${cross}-emudhra.we-have-a-problem.com`)));
    const good = ['timo.clouddo.cc', 'open.zhihu.com', 'api.weixin.qq.com', 'dysmsapi.aliyuncs.com'];
    results.push(...await Promise.all([...bad.map(host => probe(host, false)), ...good.map(host => probe(host, true))]));
  }
  const passed = results.every(row => row.passed);
  console.log(JSON.stringify({ node: process.version, stores, results, passed }, null, 2));
  if (!passed) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
