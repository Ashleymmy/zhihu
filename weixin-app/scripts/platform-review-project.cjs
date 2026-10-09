const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
function prepare(proxyPort) {
  assert(Number.isInteger(proxyPort) && proxyPort > 0);
  const project = path.join(root, '.opc-work/p2-mini-ui/project');
  fs.cpSync(path.join(root, 'weixin-app/miniprogram'), path.join(project, 'miniprogram'), { recursive: true });
  const config = JSON.parse(fs.readFileSync(path.join(root, 'weixin-app/project.config.json'), 'utf8'));
  delete config.cloudfunctionRoot; delete config.cloudfunctionTemplateRoot;
  config.projectname = 'TIMO-isolated-review'; config.setting.urlCheck = false;
  fs.writeFileSync(path.join(project, 'project.config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(project, 'project.private.config.json'), JSON.stringify({ projectname: config.projectname, setting: { urlCheck: false } }, null, 2));
  let source = fs.readFileSync(path.join(root, 'weixin-app/miniprogram/utils/request.js'), 'utf8');
  source = source.replace(/function initializeCloud\(\) \{[\s\S]*?\n\}/, 'function initializeCloud() {}');
  const start = source.indexOf('    wx.cloud.callFunction('), end = source.indexOf('\n  })', start);
  if (start < 0 || end < 0) throw Error('Request adapter changed; inspect before running');
  source = source.slice(0, start) + `    wx.request({url:'http://127.0.0.1:${proxyPort}/rpc',method:'POST',data:{path,method:options.method||'GET',data:options.data||{},token:token||undefined},success(result){success(result.data)},fail})` + source.slice(end);
  fs.writeFileSync(path.join(project, 'miniprogram/utils/request.js'), source);
  fs.writeFileSync(path.join(project, 'miniprogram/config/env.js'), "module.exports={cloudEnv:'isolated-local-review',functionName:'disabled'}\n");
  return project;
}
module.exports = prepare;
if (require.main === module) {
  const { proxyPort } = JSON.parse(fs.readFileSync(path.join(root, '.opc-work/p2-mini-ui/session.json')));
  console.log('ISOLATED_PROJECT_UPDATED', prepare(proxyPort));
}
