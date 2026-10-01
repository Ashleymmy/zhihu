const mediaTypes=['KOC视频号','KOC百家号','KOC抖音','KOC快手','KOC微博','KOC小红书','KOC定向','KOC头条号','KOC哔哩哔哩','KOC公众号'];
const types=[{value:1,label:'图文'},{value:2,label:'视频'},{value:0,label:'其他'}];
const subTypes=[{value:1,label:'实拍',parent:1},{value:2,label:'Live 图',parent:1},{value:3,label:'截屏',parent:1},{value:4,label:'漫画',parent:1},{value:5,label:'表情包解说',parent:2},{value:6,label:'真人演绎',parent:2},{value:7,label:'猫 meme',parent:2},{value:8,label:'漫剧',parent:2},{value:9,label:'解压',parent:2},{value:10,label:'滚屏',parent:2},{value:11,label:'其他',parent:0}];
function categories(index){return subTypes.filter(s=>s.parent===types[index].value);}
function blank(){return {url:'',mediaAccount:'',platformIndex:-1,publishDate:'',workTypeIndex:0,contentTypeIndex:-1,categories:categories(0)};}
function input(planId,row){
  const mediaType=mediaTypes[row.platformIndex],type=types[row.workTypeIndex],sub=categories(row.workTypeIndex)[row.contentTypeIndex];
  if(!mediaType||!row.mediaAccount.trim())throw new Error('请选择平台并填写发布作品的平台账号');
  if(!/^https?:\/\/[^\s]+$/.test(row.url.trim()))throw new Error('请填写有效的作品链接');
  if(!row.publishDate||!type||!sub)throw new Error('请填写发布日期、作品类型和子分类');
  return {planId:String(planId),mediaType,mediaAccount:row.mediaAccount.trim(),promoUrl:row.url.trim(),releaseTime:row.releaseTime||row.publishDate+'T00:00:00+08:00',compositionType:type.value,compositionSubType:sub.value};
}
function fromImport(row){
  const v=row.input,wi=types.findIndex(t=>t.value===v.compositionType);
  return {...blank(),planId:v.planId,url:v.promoUrl,mediaAccount:v.mediaAccount,platformIndex:mediaTypes.indexOf(v.mediaType),publishDate:v.releaseTime.slice(0,10),releaseTime:v.releaseTime,workTypeIndex:wi,contentTypeIndex:categories(wi).findIndex(t=>t.value===v.compositionSubType),categories:categories(wi)};
}
module.exports={mediaTypes,types,categories,blank,input,fromImport};
