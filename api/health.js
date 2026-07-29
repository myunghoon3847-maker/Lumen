module.exports=function handler(req,res){
  const origin=req.headers.origin||'';
  const allowedOrigin=/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin)||/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)?origin:'';
  if(allowedOrigin)res.setHeader('Access-Control-Allow-Origin',allowedOrigin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'GET 요청만 지원합니다.',code:'METHOD_NOT_ALLOWED'});
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({ok:true,apiKeyConfigured:Boolean(process.env.OPENAI_API_KEY),model:process.env.OPENAI_MODEL||'automatic'});
};
