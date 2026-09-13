import https from "node:https";
const HOST="soget.sintaxinformatica.it";
const PATH="/mba01/servlet/ServletDatiServizio";

function testLogin(){
  return new Promise(resolve=>{
    const user=process.env.SOGET_USER||"",pass=process.env.SOGET_PASSWORD||"";
    if(!user||!pass)return resolve({ok:false,error:"SOGET_USER / SOGET_PASSWORD mancanti"});
    const q=new URLSearchParams({tipo_operazione:"MB.AUT.A.04",userid:user,passwd:pass,xmlOutPut:"S"});
    const req=https.request({
      hostname:HOST,port:443,path:PATH+"?"+q,method:"GET",timeout:15000,
      insecureHTTPParser:true,
      headers:{"User-Agent":"Mozilla/5.0 (Android 14; LettureAcquedotto)","Accept":"*/*","Connection":"close"}
    },res=>{
      let body="";res.setEncoding("utf8");
      res.on("data",c=>body+=c);
      res.on("end",()=>{
        const denied=/ACCESSO\s+NEGATO/i.test(body), cookies=res.headers["set-cookie"]||[];
        resolve({
          ok:(res.statusCode||500)<400&&!denied&&cookies.length>0,
          status:res.statusCode,
          denied,
          cookieCount:cookies.length,
          error:denied?"ACCESSO NEGATO":(!cookies.length?"Nessun cookie di sessione":null)
        });
      });
    });
    req.on("timeout",()=>req.destroy(Object.assign(new Error("Timeout"),{code:"ETIMEDOUT"})));
    req.on("error",e=>resolve({ok:false,error:`${e.code||""} ${e.message}`.trim()}));
    req.end();
  });
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const supabase=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY);
  const soget=await testLogin();
  res.status(200).json({
    supabase:{ok:supabase,error:supabase?null:"SUPABASE_URL / SUPABASE_ANON_KEY mancanti"},
    soget
  });
}