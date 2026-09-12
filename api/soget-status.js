import { XMLParser } from "fast-xml-parser";

const BASE = "https://soget.sintaxinformatica.it/mba01/servlet/ServletDatiServizio";
const SEARCH_BASE = {
  xmlOutPut:"S", tipo:"mobile", range:"90", tipo_operazione:"SI.COA.R.01",
  cognome:"", codiceFiscale:"", codice:"", indirizzo:"", civico:"",
  numero:"", contatore:"", categoria:"99", ultimaLettura:"S"
};

function cookieHeader(headers){
  const raw = headers.getSetCookie ? headers.getSetCookie() : [];
  if(raw?.length) return raw.map(x=>x.split(";")[0]).join("; ");
  const c=headers.get("set-cookie");
  if(!c) return "";
  return c.split(/,(?=[^;,]+=)/).map(x=>x.split(";")[0]).join("; ");
}

async function call(params,cookie=""){
  const u=new URL(BASE);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v??"")));
  const r=await fetch(u,{
    method:"GET",
    headers:{
      "User-Agent":"Mozilla/5.0 (Android; LettureAcquedotto live bridge)",
      ...(cookie?{"Cookie":cookie}:{})
    },
    redirect:"manual"
  });
  const text=await r.text();
  if(!r.ok) throw new Error(`SOGET HTTP ${r.status}`);
  return {text,cookie:cookieHeader(r.headers)};
}

function flatten(obj,prefix="",out={}){
  if(obj==null) return out;
  if(typeof obj!=="object"){ if(prefix) out[prefix]=String(obj); return out; }
  if(Array.isArray(obj)){ obj.forEach((x,i)=>flatten(x,prefix?`${prefix}.${i}`:String(i),out)); return out; }
  for(const [k,v] of Object.entries(obj)){
    if(k.startsWith("@_")) out[(prefix?prefix+".":"")+k.slice(2)]=String(v??"");
    else if(k==="#text"){ if(prefix) out[prefix]=String(v??""); }
    else flatten(v,prefix?`${prefix}.${k}`:k,out);
  }
  return out;
}

function collectObjects(obj,arr=[]){
  if(obj && typeof obj==="object"){
    if(!Array.isArray(obj)){
      const f=flatten(obj);
      const keys=Object.keys(f).join(" ").toLowerCase();
      if(keys.includes("idutenza") && (keys.includes("contatore")||keys.includes("intestatario"))) arr.push(f);
    }
    for(const v of Object.values(obj)) collectObjects(v,arr);
  }
  return arr;
}

function pick(row,name){
  const target=name.toLowerCase();
  for(const [k,v] of Object.entries(row)){
    const kl=k.toLowerCase();
    if(kl===target || kl.endsWith("."+target)) return String(v??"").trim();
  }
  return "";
}
function norm(s){return String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"")}
function eqv(s){return norm(s).replaceAll("B","8").replaceAll("O","0").replaceAll("I","1").replaceAll("S","5").replaceAll("Z","2")}

function parseRows(xml){
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",trimValues:true});
  const parsed=parser.parse(xml);
  const rows=collectObjects(parsed);
  const seen=new Set(), out=[];
  for(const row of rows){
    const id=pick(row,"idUtenza"), meter=pick(row,"contatore");
    const k=id+"|"+meter;
    if(id && meter && !seen.has(k)){seen.add(k);out.push(row)}
  }
  return out;
}

async function login(){
  const user=process.env.SOGET_USER;
  const pass=process.env.SOGET_PASSWORD;
  if(!user||!pass) throw new Error("Credenziali SO.G.E.T. non configurate su Vercel");
  const r=await call({tipo_operazione:"MB.AUT.A.04",userid:user,passwd:pass,xmlOutPut:"S"});
  if(/ACCESSO\s+NEGATO/i.test(r.text)) throw new Error("SO.G.E.T.: ACCESSO NEGATO (controlla utente/password)");
  if(!r.cookie) throw new Error("Login SO.G.E.T. non riuscito: nessuna sessione ricevuta");
  return r.cookie;
}

async function statusForMeter(cookie,meter){
  const cleaned=String(meter||"").trim();
  if(cleaned.length<3) return {meter:cleaned,status:"INVALID",found:false};
  const p={...SEARCH_BASE,contatore:cleaned};
  const r=await call(p,cookie);
  const rows=parseRows(r.text);
  const n=eqv(cleaned);
  let exact=rows.find(x=>eqv(pick(x,"contatore"))===n);
  if(!exact){
    const c=rows.filter(x=>{
      const a=eqv(pick(x,"contatore"));
      return a.length>=5 && n.length>=5 && (a.endsWith(n)||n.endsWith(a));
    });
    if(c.length===1) exact=c[0];
  }
  if(!exact) return {meter:cleaned,status:"NOT_FOUND",found:false,candidates:rows.slice(0,5).map(x=>({
    idUtenza:pick(x,"idUtenza"),meter:pick(x,"contatore"),owner:pick(x,"intestatario"),address:pick(x,"indirizzo")
  }))};

  const isRead=pick(exact,"isLetturaRilevata").toUpperCase()==="S";
  const illegible=pick(exact,"isIllegibile").toUpperCase()==="S";
  return {
    meter:cleaned,found:true,status:illegible?"ILLEGIBLE":(isRead?"READ":"UNREAD"),
    idUtenza:pick(exact,"idUtenza"),
    codice:pick(exact,"codice"),
    numeroContratto:pick(exact,"numero"),
    serverMeter:pick(exact,"contatore"),
    owner:pick(exact,"intestatario"),
    address:pick(exact,"indirizzo"),
    civico:pick(exact,"civico"),
    isRead,illegible,
    lastReading:pick(exact,"ultimaLettura"),
    lastReadingDate:pick(exact,"dataUltimaLettura"),
    idUltimaLettura:pick(exact,"idUltimaLettura"),
    idRilevazione:pick(exact,"idRilevazione"),
    piombato:pick(exact,"piombato"),
    countMancateRilevazioni:pick(exact,"countMancateRilevazioni")
  };
}

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"POST required"});
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
    const meters=[...new Set((body.meters || (body.meter?[body.meter]:[])).map(String).map(x=>x.trim()).filter(Boolean))].slice(0,25);
    if(!meters.length) return res.status(400).json({error:"Nessuna matricola"});
    const cookie=await login();
    const results=[];
    for(const m of meters){
      try{ results.push(await statusForMeter(cookie,m)); }
      catch(e){ results.push({meter:m,status:"ERROR",found:false,error:String(e?.message||e)}) }
    }
    res.setHeader("Cache-Control","no-store");
    return res.status(200).json({ok:true,checkedAt:new Date().toISOString(),results});
  }catch(e){
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
}
