const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const serverRoot = path.resolve(__dirname, '../..');
const root = path.resolve(serverRoot, '..');
for (const role of ['admin', 'leader', 'creator']) {
  if (!fs.existsSync(path.join(root, 'apps', 'platform-' + role, 'dist/index.html'))) {
    throw Error('缺少三端构建产物，请先在仓库根运行 pnpm build');
  }
}
const out = path.join(root, '.opc-work', 'attribution-demo', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
fs.mkdirSync(out, { recursive: true });
const log = fs.createWriteStream(path.join(out, 'host.log'));
const child = spawn(process.execPath, [
  '--import', pathToFileURL(path.join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href,
  path.join(__dirname, 'host.ts'),
], {
  cwd: serverRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, ATTRIBUTION_UI_TEST: '1', ATTRIBUTION_DEMO_OUT: out },
});
child.stdout.pipe(log);
child.stderr.pipe(log);
let stopping = false, stopTimer;
function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(startup);
  console.log('正在关闭本次演练并回收隔离数据库…');
  if (child.connected) child.send('stop');
  stopTimer = setTimeout(() => child.kill(), 30000);
  process.stdin.pause();
}
const startup = setTimeout(() => {
  console.error('启动超过 120 秒，请检查 Docker 和日志：' + path.join(out, 'host.log'));
  process.exitCode = 1;
  stop();
}, 120000);
child.on('message', (message) => {
  if (!message.port) return;
  clearTimeout(startup);
  fs.writeFileSync(path.join(out, 'session.json'), JSON.stringify(message, null, 2));
  console.log('\nOPC 知乎隔离演练已就绪（试算模式）');
  for (const role of ['admin', 'leader', 'creator']) console.log(`${role}: http://127.0.0.1:${message.port}/${role}/login`);
  console.log('账号分别为 admin / leader / creator，密码均为 isolated_password');
  console.log('业务日期：' + message.demo.day);
  console.log('报告目录：' + out);
  console.log('先上传 01-首次报告100单.xlsx，再按测试指南核验和确认；之后使用 02-修订报告90单.xlsx。');
  console.log('不要关闭此终端。输入 q 后回车或按 Ctrl+C 结束；结束后测试库清除，生成的文件和日志保留。');
  if (process.argv.includes('--check')) stop();
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; stop(); });
child.on('exit', (code) => {
  clearTimeout(startup);
  clearTimeout(stopTimer);
  process.stdin.pause();
  log.end();
  if (code !== 0) {
    process.exitCode = 1;
    console.error('演练进程退出异常，请查看：' + path.join(out, 'host.log'));
  }
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (value) => { if (value.trim().toLowerCase() === 'q') stop(); });
console.log('正在创建隔离 MySQL 并准备模拟业务，首次运行可能需要下载镜像…');
