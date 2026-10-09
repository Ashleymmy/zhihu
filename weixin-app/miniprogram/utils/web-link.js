// Only authenticated Web routes; never include a token in a copied URL.
const routes={finance:'/finance',reports:'/finance',prices:'/rates',tasks:'/tasks'};
function copy(page,key,extra={}) {
  if(!page.canAct()||!routes[key])return;
  const scope=page._context.scope;
  const query={projectId:scope.projectId,accountId:scope.accountId,...extra};
  const url='https://timo.clouddo.cc/app'+routes[key]+'?'+Object.keys(query).filter(k=>query[k]).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(query[k])).join('&');
  wx.setClipboardData({data:url,success:()=>{if(page.canAct())page.setData({notice:'地址已复制，在浏览器打开后登录同一账号即可继续。'});}});
}
module.exports={copy};
