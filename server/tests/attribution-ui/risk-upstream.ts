import {http,HttpResponse} from 'msw';
export function riskReviewHandlers(){
 if(process.env.REMEDIATION_REVIEW!=='1'||process.env.OPC_REVIEW_RISK_REPORTS!=='1')return[];
 let token=0,uncertainOnce=true;
 const records=[{keyword:'示例截流词',risk_type:1,type:1,status:0,channel:'知乎故事一代渠道',create_channel:'知乎故事一代渠道',valided_at:''},{keyword:'示例搬运词',risk_type:2,type:0,status:1,channel:'知乎故事一代渠道',create_channel:'其他渠道',valided_at:'2026-11-05 09:00:00'}];
 return[
  http.post('https://open.zhihu.com/alliance/api/basic/file_upload',()=>HttpResponse.json({success:true,data:{file_token:'isolated-'+(++token)}})),
  http.post('https://open.zhihu.com/alliance/api/risk_words',async({request})=>{
   const input=await request.json() as {keyword:string;risk_type:number};
   if(input.keyword==='隔离待核对'&&uncertainOnce){uncertainOnce=false;return HttpResponse.error();}
   records.unshift({keyword:input.keyword,risk_type:input.risk_type,type:1,status:0,channel:'知乎故事一代渠道',create_channel:'知乎故事一代渠道',valided_at:''});
   return HttpResponse.json({success:true,data:'',msg:'操作成功'});
  }),
  http.get('https://open.zhihu.com/alliance/api/risk_words',({request})=>{
   const p=new URL(request.url).searchParams,offset=Number(p.get('offset')||0),limit=Number(p.get('limit')||20);
   const result=records.filter(r=>r.type===Number(p.get('type')||0)&&(!p.get('keyword')||r.keyword.includes(p.get('keyword')!))&&(!p.get('risk_type')||r.risk_type===Number(p.get('risk_type')))&&(!p.get('status')||r.status===Number(p.get('status'))-1));
   return HttpResponse.json({data:result.slice(offset,offset+limit),pagination:{is_first:offset===0,is_end:offset+limit>=result.length,offset,limit,total:result.length}});
  }),
 ];
}
