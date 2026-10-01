const cloud=require('wx-server-sdk');
const {createBridge}=require('./bridge');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
exports.main=createBridge({context:()=>cloud.getWXContext(),secret:process.env.WECHAT_BRIDGE_SECRET});
