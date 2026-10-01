// 微信小程序按 envVersion 区分三个版本：develop(开发版) / trial(体验版) / release(正式版)。
//
// 环境现状（2026-09-24 扶正）：
//   - 开发环境 cloud1-d4g9ou4cd3b80d764：迁移数据源，UI 预览模式，业务写入返回 409。
//     开发/调试只用它，不再当预览目标。
//   - 测试环境 test-opc-app-d3gki762bfb61da92：已完成迁移并 seal，写入已开放。
//     2026-09-24 起扶正为正式生产环境（内部用户已在其上注册）。
const DEVELOPMENT_ENV = 'cloud1-d4g9ou4cd3b80d764'
// 与开发环境分离的环境：已完成数据迁移并 seal，现为正式生产环境
const PRODUCTION_ENV = 'test-opc-app-d3gki762bfb61da92'
const environments = {
  // 开发者工具/模拟器（develop）也指向生产环境：模拟器验收和页面联调都跑在真实链路上
  // （与 2026-09-18 以来的口径一致）。开发环境 cloud1 是冻结的迁移数据源，不挂载任何版本。
  development: { cloudEnv: PRODUCTION_ENV },
  // 体验版与正式版都跑生产环境。
  test: { cloudEnv: PRODUCTION_ENV },
  production: { cloudEnv: PRODUCTION_ENV },
}
const versions = { develop: 'development', trial: 'test', release: 'production' }
let current = 'development'
try { current = versions[wx.getAccountInfoSync().miniProgram.envVersion] || 'production' } catch (_) {}
const selected = environments[current]

// 守卫保留：任何版本若指回开发环境迁移数据源，release 版直接拒绝启动。
// 宁可发布失败，也不能让正式版把真实业务数据写进开发库。
if (current === 'production' && selected.cloudEnv === DEVELOPMENT_ENV) {
  throw new Error(
    '生产环境配置错误：正式版指向了开发环境 ' + DEVELOPMENT_ENV + '，已阻止启动。' +
    '请检查 miniprogram/config/env.js 中 production.cloudEnv。'
  )
}

module.exports = Object.assign({ environment: current, transport: 'cloud', functionName: 'opc-bridge' }, selected)
