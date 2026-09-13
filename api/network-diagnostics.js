
import dns from "node:dns/promises";
import tls from "node:tls";
import https from "node:https";

const HOST="soget.sintaxinformatica.it";
const BASE="https://soget.sintaxinformatica.it/mba01/servlet/ServletDatiServizio";

function safeError(e){
  return {
    name:e?.name||null,
    message:e?.message||String(e),
    code:e?.code||e?.cause?.code||null,
    errno:e?.errno||e?.cause?.errno||null,
    syscall:e?.syscall||e?.cause?.syscall||null,
    address:e?.address||e?.cause?.address||null,
    port:e?.port||e?.cause?.port||null,
    cause:e?.cause?.message||null
  };
}

async function testDns(){
  try{
    const res=await dns.lookup(HOST,{all:true});
    return {ok:true,addresses:res};
  }catch(e){
    return {ok:false,error:safeError(e)};
  }
}

async function testTls(){
  return await new Promise(resolve=>{
    let done=false;
    const finish=v=>{if(!done){done=true;resolve(v)}};
    const socket=tls.connect({
      host:HOST,
      port:443,
      servername:HOST,
      rejectUnauthorized:true,
      timeout:10000
    },()=>{
      const cert=socket.getPeerCertificate();
      finish({
        ok:true,
        protocol:socket.getProtocol(),
        authorized:socket.authorized,
        authorizationError:socket.authorizationError||null,
        cert:{
          subject:cert?.subject||null,
          issuer:cert?.issuer||null,
          valid_from:cert?.valid_from||null,
          valid_to:cert?.valid_to||null
        }
      });
      socket.end();
    });
    socket.on("timeout",()=>{
      socket.destroy();
      finish({ok:false,error:{message:"TLS timeout",code:"ETIMEDOUT"}});
    });
    socket.on("error",e=>finish({ok:false,error:safeError(e)}));
  });
}

async function rawHttps(path="/"){
  return await new Promise(resolve=>{
    let done=false;
    const finish=v=>{if(!done){done=true;resolve(v)}};
    const req=https.request({
      hostname:HOST,
      port:443,
      path,
      method:"GET",
      timeout:12000,
      headers:{
        "User-Agent":"Mozilla/5.0",
        "Accept":"*/*",
        "Connection":"close"
      }
    },res=>{
      let data="";
      res.setEncoding("utf8");
      res.on("data",c=>{if(data.length<1000)data+=c});
      res.on("end",()=>finish({
        ok:true,
        status:res.statusCode,
        headers:{
          server:res.headers.server||null,
          location:res.headers.location||null,
          contentType:res.headers["content-type"]||null
        },
        preview:data.slice(0,300)
      }));
    });
    req.on("timeout",()=>req.destroy(Object.assign(new Error("HTTPS timeout"),{code:"ETIMEDOUT"})));
    req.on("error",e=>finish({ok:false,error:safeError(e)}));
    req.end();
  });
}

async function testServlet(){
  return rawHttps("/mba01/servlet/ServletDatiServizio?xmlOutPut=S");
}

async function testLogin(){
  const user=process.env.SOGET_USER||"";
  const pass=process.env.SOGET_PASSWORD||"";
  if(!user||!pass) return {ok:false,error:{message:"SOGET_USER / SOGET_PASSWORD mancanti"}};

  const u=new URL(BASE);
  u.searchParams.set("tipo_operazione","MB.AUT.A.04");
  u.searchParams.set("userid",user);
  u.searchParams.set("passwd",pass);
  u.searchParams.set("xmlOutPut","S");

  return await new Promise(resolve=>{
    let done=false;
    const finish=v=>{if(!done){done=true;resolve(v)}};
    const req=https.request({
      hostname:HOST,
      port:443,
      path:u.pathname+"?"+u.searchParams.toString(),
      method:"GET",
      timeout:15000,
      headers:{
        "User-Agent":"Mozilla/5.0 (Android 14; LettureAcquedotto)",
        "Accept":"*/*",
        "Connection":"close"
      }
    },res=>{
      let data="";
      const cookies=res.headers["set-cookie"]||[];
      res.setEncoding("utf8");
      res.on("data",c=>{if(data.length<3000)data+=c});
      res.on("end",()=>{
        const denied=/ACCESSO\s+NEGATO/i.test(data);
        finish({
          ok:res.statusCode>=200&&res.statusCode<400&&!denied,
          status:res.statusCode,
          denied,
          cookieCount:cookies.length,
          preview:data.slice(0,500)
        });
      });
    });
    req.on("timeout",()=>req.destroy(Object.assign(new Error("Login timeout"),{code:"ETIMEDOUT"})));
    req.on("error",e=>finish({ok:false,error:safeError(e)}));
    req.end();
  });
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const dnsResult=await testDns();
  const tlsResult=await testTls();
  const httpsRoot=await rawHttps("/");
  const servlet=await testServlet();
  const login=await testLogin();

  res.status(200).json({
    ok:true,
    checkedAt:new Date().toISOString(),
    region:process.env.VERCEL_REGION||null,
    host:HOST,
    dns:dnsResult,
    tls:tlsResult,
    httpsRoot,
    servlet,
    login
  });
}
