const cloud=require('wx-server-sdk')
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV})
const {Store}=require('./lib/store')
const {createAPI}=require('./lib/api')
const environment=process.env.TCB_ENV||process.env.SCF_NAMESPACE||'cloud1-d4g9ou4cd3b80d764'
const store=new Store(cloud.database())
const api=createAPI(store,cloud,environment)
const handle=require('./lib/gateway').gateway(store,api,()=>cloud.getWXContext(),{environment,developmentAccess:require('./development-access.json')})
exports.main=event=>event?.action==='runtime-readiness'?require('./lib/runtime-readiness').check(store,cloud.getWXContext(),{functionName:'opc-api',probe:event.probe}):handle(event)
