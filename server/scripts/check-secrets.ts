/**
 * 生产部署前的密钥/环境检查。
 * 用法：npx tsx scripts/check-secrets.ts（或部署流水线中作为 preflight）
 * 任一失败以非零退出码结束。
 */
const required: Array<{ key: string; minLen?: number; hint: string }> = [
  { key: 'JWT_SECRET', minLen: 32, hint: '至少 32 位随机字符串（openssl rand -hex 32）' },
  { key: 'CALLBACK_SECRET_ENCRYPTION_KEY', minLen: 64, hint: '64 位 hex（openssl rand -hex 32）' },
  { key: 'DB_HOST', hint: '数据库主机' },
  { key: 'DB_NAME', hint: '数据库名' },
  { key: 'DB_USER', hint: '数据库用户' },
  { key: 'DB_PASS', minLen: 12, hint: '数据库密码至少 12 位' },
  { key: 'REDIS_URL', hint: 'redis://:password@host:6379' },
  { key: 'ZHIHU_ACCESS_TOKEN', hint: '知乎开放平台 AccessToken' },
  { key: 'ZHIHU_SECRET_KEY', hint: '知乎开放平台 SecretKey' },
];

let failed = 0;
for (const { key, minLen, hint } of required) {
  const value = process.env[key];
  if (!value) {
    console.error(`✗ ${key} 未设置 —— ${hint}`);
    failed++;
  } else if (minLen && value.length < minLen) {
    console.error(`✗ ${key} 长度不足（当前 ${value.length}，要求 ≥${minLen}）—— ${hint}`);
    failed++;
  } else {
    console.log(`✓ ${key}`);
  }
}

if (process.env.NODE_ENV === 'production') {
  if (!process.env.ALLIANCE_QUOTA_POLICY) {
    console.error('✗ ALLIANCE_QUOTA_POLICY 未设置（生产模式启动会崩溃）');
    failed++;
  }
  const gates = process.env.FINANCE_GATES_PASSED ?? '';
  if (gates) console.log(`ℹ FINANCE_GATES_PASSED=${gates}（资金链 Gate：${gates.split(',').length}/4 通过）`);
  else console.log('ℹ FINANCE_GATES_PASSED 未设置（提现保持关闭，默认安全）');
}

if (failed) {
  console.error(`\n${failed} 项检查未通过`);
  process.exit(1);
}
console.log('\n全部通过');
