import {http,HttpResponse} from 'msw';
export const saltFixtureBoards=[
 {id:'1661766472115556352',name:'高评论书籍',type:1,updated_at:'2026-11-05 02:02:36'},
 {id:'1710322868645269504',name:'推荐书单',type:2,updated_at:'2026-11-05 02:02:36'},
 {id:'1710322868645269505',name:'空榜单',type:1,updated_at:null},
];
export function saltFixtureContents(id:string,offset:number,limit:number){
 const size=id===saltFixtureBoards[0].id?24:id===saltFixtureBoards[1].id?2:0;
 const data=Array.from({length:size},(_,i)=>({id:String(2099827666153124981n+BigInt(i)),title:(id===saltFixtureBoards[1].id?'推荐小说':'榜单小说')+(i+1),url:'https://www.zhihu.com/market/paid_column/2099133153059288370/section/'+i,paid_column:{title:'所属专栏',url:'https://www.zhihu.com/xen/market/remix/paid_column/2099133153059288370'},topic:[{name:'情感',url:''},{name:'现代',url:''}],category:'小说',content_type:'盐选专栏',...(id===saltFixtureBoards[1].id?{content_subjective_level:'2',bayes_first_category:'情感',bayes_second_category:'家庭 / 婚姻',theme:'亲情',r_cmd_consume_value:'推荐内容'}:{})}));
 return {data:data.slice(offset,offset+limit),pagination:{is_first:offset===0,is_end:offset+limit>=size,offset,limit,total:size}};
}
export function saltReviewHandlers(){
 if(process.env.REMEDIATION_REVIEW!=='1'||process.env.OPC_REVIEW_SALT_BOARDS!=='1')return [];
 return [http.get('https://open.zhihu.com/alliance/api/vip/content/rule/labels',()=>HttpResponse.json(saltFixtureBoards)),http.get('https://open.zhihu.com/alliance/api/vip/rule_contents',({request})=>{const p=new URL(request.url).searchParams;return HttpResponse.json(saltFixtureContents(p.get('rule_id')||'',Number(p.get('offset')||0),Number(p.get('limit')||20)))})];
}
