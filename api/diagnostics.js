
const BASE="https://soget.sintaxinformatica.it/mba01/servlet/ServletDatiServizio";

function getCookie(headers){
  try{
    if(typeof headers.getSetCookie==="function"){
      const x=headers.getSetCookie();
      if(x?.length) return x.map(v=>v.split(";")[0]).join("; ");
    }
  }catch{}
  const raw=headers.get("set-cookie")||"";
  return raw ? raw.split(/,(?=[^;,]+=)/).map(x=>x.split(";")[0]).join("; ") : "";
}
async function sogetLogin(){
  const user=process.env.SOGET_USER||"";
  const pass=process.env.SOGET_PASSWORD||"";
  if(!user||!pass) return {ok:false,error:"SOGET_USER / SOGET_PASSWORD mancanti su Vercel"};
  const u=new URL(BASE);
  u.searchParams.set("tipo_operazione","MB.AUT.A.04");
  u.searchParams.set("userid",user);
  u.searchParams.set("passwd",pass);
  u.searchParams.set("xmlOutPut","S");
  const r=await fetch(u,{headers:{"User-Agent":"LettureAcquedotto/1.0"},redirect:"manual"});
  const text=await r.text();
  const denied=/ACCESSO\s+NEGATO/i.test(text);
  const cookie=getCookie(r.headers);
  if(!r.ok) return {ok:false,error:`HTTP ${r.status}`};
  if(denied) return {ok:false,error:"SO.G.E.T. ha risposto ACCESSO NEGATO"};
  if(!cookie) return {ok:false,error:"Login senza cookie di sessione",preview:text.slice(0,180)};
  const op=(text.match(/(?:utente|user|operatore)[^>]*>\s*([^<]+)/i)||[])[1]||null;
  return {ok:true,userConfigured:user,operator:op,cookieReceived:true};
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const supabase=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY);
  let soget;
  try{soget=await sogetLogin()}catch(e){soget={ok:false,error:String(e?.message||e)}}
  return res.status(200).json({
    supabase:{ok:supabase,error:supabase?null:"SUPABASE_URL / SUPABASE_ANON_KEY mancanti su Vercel"},
    soget
  });
}
