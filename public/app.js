let sb=null;
let runtimeConfig={};

async function loadRuntimeConfig(){
  try{
    const r=await fetch("/api/config",{cache:"no-store"});
    if(!r.ok) throw new Error("API config HTTP "+r.status);
    runtimeConfig=await r.json();

    if(!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey){
      return false;
    }
    if(!window.supabase){
      throw new Error("Libreria Supabase non caricata");
    }

    sb=window.supabase.createClient(
      runtimeConfig.supabaseUrl,
      runtimeConfig.supabaseAnonKey
    );
    return true;
  }catch(e){
    console.error("Configurazione:",e);
    return false;
  }
}

let records=[],soget=[],map,markers=[],editing=null,currentUser=null,liveTimer=null,ocrWorker=null;

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const norm=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const eqv=s=>norm(s).replaceAll("B","8").replaceAll("O","0").replaceAll("I","1").replaceAll("S","5").replaceAll("Z","2");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function badge(status){
  const m={
    READ:["✅ GIÀ LETTO","ok"],
    UNREAD:["🟢 DA LEGGERE","ok"],
    ILLEGIBLE:["⚠️ ILLEGIBILE","warn"],
    NOT_FOUND:["❔ NON TROVATO","warn"],
    ERROR:["🔴 ERRORE LIVE","warn"],
    INVALID:["⚠️ MATRICOLA DA VERIFICARE","warn"]
  };
  const x=m[status]||["⚪ NON CONTROLLATO","small"];
  return `<span class="${x[1]}"><b>${x[0]}</b></span>`;
}


function fmtDiag(x){
  const line=(name,v)=>{
    if(!v) return `${name}: —`;
    if(v.ok) return `${name}: ✅ OK` +
      (v.status?` · HTTP ${v.status}`:"") +
      (v.protocol?` · ${v.protocol}`:"") +
      (v.denied?" · ACCESSO NEGATO":"") +
      (v.cookieCount!=null?` · cookie ${v.cookieCount}`:"");
    const e=v.error||{};
    return `${name}: ❌ ${e.code||""} ${e.message||"errore"}`.trim();
  };
  return [
    `Regione Vercel: ${x.region||"n/d"}`,
    line("DNS",x.dns),
    x.dns?.ok ? `  ${x.dns.addresses.map(a=>a.address).join(", ")}` : "",
    line("TLS",x.tls),
    line("HTTPS root",x.httpsRoot),
    line("Servlet",x.servlet),
    line("Login",x.login),
    x.login?.preview ? `\nRisposta login:\n${x.login.preview}` : "",
    x.servlet?.preview ? `\nRisposta servlet:\n${x.servlet.preview}` : ""
  ].filter(Boolean).join("\n");
}
async function runDeepDiagnostics(){
  const out=$("#deepDiagOut");
  out.textContent="Diagnostica rete in corso…";
  try{
    const r=await fetch("/api/network-diagnostics",{cache:"no-store"});
    const x=await r.json();
    out.textContent=fmtDiag(x);
  }catch(e){
    out.textContent="Errore diagnostica: "+e.message;
  }
}

async function runDiagnostics(){
  const out=$("#diagOut");
  if(out) out.textContent="Controllo…";
  try{
    const r=await fetch("/api/diagnostics",{cache:"no-store"});
    const x=await r.json();
    const sp=x.supabase?.ok ? "✅ Supabase OK" : `❌ Supabase: ${x.supabase?.error||"errore"}`;
    const sg=x.soget?.ok ? `✅ SO.G.E.T. OK${x.soget.operator?` · operatore ${x.soget.operator}`:""}` :
      `❌ SO.G.E.T.: ${x.soget?.error||"errore"}`;
    if(out) out.innerHTML=`${sp}<br>${sg}`;
    $("#liveStatus").textContent=x.soget?.ok?"SO.G.E.T. LIVE ✓":"SO.G.E.T. errore";
    return x;
  }catch(e){
    if(out) out.textContent="❌ Diagnostica non raggiungibile: "+e.message;
    return null;
  }
}


function levenshtein(a,b){
  a=String(a||""); b=String(b||"");
  const m=a.length,n=b.length,dp=Array(n+1).fill(0).map((_,j)=>j);
  for(let i=1;i<=m;i++){
    let prev=dp[0]; dp[0]=i;
    for(let j=1;j<=n;j++){
      const tmp=dp[j];
      dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=tmp;
    }
  }
  return dp[n];
}
function meterNorm(s){
  return String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
}
function meterEquiv(s){
  return meterNorm(s)
    .replaceAll("B","8").replaceAll("O","0")
    .replaceAll("I","1").replaceAll("L","1")
    .replaceAll("S","5").replaceAll("Z","2")
    .replaceAll("G","6");
}
function digitish(s){
  return String(s||"").toUpperCase()
    .replace(/[OQDG]/g,"0").replace(/[IL|]/g,"1")
    .replace(/Z/g,"2").replace(/S/g,"5").replace(/B/g,"8")
    .replace(/[^0-9]/g,"");
}
function allTokens(text){
  const raw=String(text||"").toUpperCase().replace(/\r/g,"\n");
  const out=[];
  for(const line of raw.split(/\n+/)){
    for(const m of line.matchAll(/[A-Z0-9][A-Z0-9\s./-]{2,20}[A-Z0-9]/g)){
      const t=m[0].trim().replace(/\s+/g," ");
      if(t.length>=3) out.push(t);
    }
    for(const m of line.matchAll(/[A-Z0-9/-]{4,18}/g)) out.push(m[0]);
  }
  return [...new Set(out)];
}
function bestMeterCandidate(text){
  if(!soget?.length)return null;
  const tokens=allTokens(text)
    .map(t=>({raw:t,n:meterEquiv(t)}))
    .filter(x=>x.n.length>=5 && x.n.length<=18);

  let best=null;
  for(const tok of tokens){
    for(const u of soget){
      const db=meterEquiv(u.matricola);
      if(!db || db.length<5)continue;
      let score=0,dist=99;
      if(tok.n===db){score=100;dist=0}
      else if(tok.n.endsWith(db)||db.endsWith(tok.n)){
        const diff=Math.abs(tok.n.length-db.length);
        score=94-Math.min(diff*2,12);dist=diff;
      }else{
        dist=levenshtein(tok.n,db);
        const max=Math.max(tok.n.length,db.length);
        score=Math.round(100*(1-dist/max));
      }
      // favour realistic serial sizes and digit-heavy tokens
      const digits=(tok.n.match(/\d/g)||[]).length;
      score += Math.min(4,Math.max(0,digits-5)*0.5);
      if(!best || score>best.score){
        best={score,dist,token:tok.raw,meter:u.matricola,user:u};
      }
    }
  }
  return best && best.score>=68 ? best : null;
}
function readingCandidates(text,chosenMeter){
  const meterDigits=digitish(chosenMeter||"");
  const toks=allTokens(text);
  const out=[];
  for(const raw of toks){
    const d=digitish(raw);
    if(d.length<3 || d.length>9)continue;
    if(meterDigits && (d===meterDigits || meterDigits.includes(d) || d.includes(meterDigits)))continue;

    // Reads are usually 4–6 black integer digits. Red decimal wheels can be appended;
    // when 7–8 digits appear, prefer first 5/6 as integer part.
    const variants=[d];
    if(d.length>=7) variants.push(d.slice(0,5),d.slice(0,6));
    if(d.length===6) variants.push(d.slice(0,5));

    for(const v of variants){
      if(v.length<3 || v.length>6)continue;
      let score=0;
      if(/^0/.test(v))score+=20;
      if(v.length===5)score+=28;
      else if(v.length===6)score+=22;
      else if(v.length===4)score+=15;
      else score+=8;
      if(Number(v)<1000000)score+=8;
      // reject obvious years/specs
      if(/^20(1|2)\d$/.test(v))score-=25;
      out.push({raw,digits:v,value:Number(v),score});
    }
  }
  out.sort((x,y)=>y.score-x.score);
  return out;
}
async function getOcrWorker(){
  if(ocrWorker)return ocrWorker;
  if(!window.Tesseract)throw new Error("Motore OCR non caricato");
  ocrWorker=await Tesseract.createWorker("eng",1,{
    logger:m=>{
      if(m.status==="recognizing text"){
        const p=Math.round((m.progress||0)*100);
        const el=$("#uploadStatus"); if(el)el.textContent=`OCR ${p}%…`;
      }
    }
  });
  await ocrWorker.setParameters({
    tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-., ",
    preserve_interword_spaces:"1",
    user_defined_dpi:"180"
  });
  return ocrWorker;
}
async function imageCanvas(file,rotation=0){
  const bmp=await createImageBitmap(file);
  const max=1600,scale=Math.min(1,max/Math.max(bmp.width,bmp.height));
  const sw=Math.max(1,Math.round(bmp.width*scale)),sh=Math.max(1,Math.round(bmp.height*scale));
  const rot=((rotation%360)+360)%360;
  const c=document.createElement("canvas");
  c.width=(rot===90||rot===270)?sh:sw;
  c.height=(rot===90||rot===270)?sw:sh;
  const ctx=c.getContext("2d");
  ctx.translate(c.width/2,c.height/2);
  ctx.rotate(rot*Math.PI/180);
  ctx.drawImage(bmp,-sw/2,-sh/2,sw,sh);
  return c;
}
async function recognizeAtRotation(file,rotation){
  const worker=await getOcrWorker();
  const canvas=await imageCanvas(file,rotation);
  const {data}=await worker.recognize(canvas);
  const text=data?.text||"";
  const meter=bestMeterCandidate(text);
  const reads=readingCandidates(text,meter?.meter);
  return {rotation,text,confidence:data?.confidence||0,meter,reading:reads[0]||null};
}
async function recognizeMeterPhoto(file){
  // First pass. If database match is weak, rotate and retry.
  const tries=[];
  for(const rot of [0,90,270,180]){
    const r=await recognizeAtRotation(file,rot);
    tries.push(r);
    if(r.meter?.score>=92 && r.reading?.score>=25)break;
    if(rot===90 && tries.some(x=>x.meter?.score>=86) && tries.some(x=>x.reading))break;
  }
  tries.sort((a,b)=>{
    const sa=(a.meter?.score||0)+(a.reading?.score||0)+(a.confidence||0)*0.08;
    const sb=(b.meter?.score||0)+(b.reading?.score||0)+(b.confidence||0)*0.08;
    return sb-sa;
  });
  const best=tries[0]||{};
  return {
    meter:best.meter?.meter||null,
    meterScore:best.meter?.score||0,
    matchedUser:best.meter?.user||null,
    reading:best.reading?.value ?? null,
    readingRaw:best.reading?.digits||null,
    rotation:best.rotation||0,
    ocrText:best.text||"",
    confidence:best.confidence||0,
    review:!(best.meter?.score>=82 && best.reading)
  };
}

function initMap(){
  if(typeof L==="undefined"){
    console.error("Leaflet non caricato");
    $("#map").innerHTML='<div class="warn" style="padding:16px">Mappa non caricata: libreria Leaflet non raggiungibile.</div>';
    return;
  }
  map=L.map("map").setView([38.89,16.75],12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png".replace("/{y}/{x}","/{z}/{x}/{y}"),{maxZoom:20,attribution:"© OpenStreetMap"}).addTo(map);
}
async function loadSoget(){try{soget=await fetch("/data/utenze.json",{cache:"no-store"}).then(r=>r.json())}catch{soget=[]}}
function matchMeter(m){
  const n=eqv(m);if(!n)return null;
  let x=soget.find(a=>eqv(a.matricola)===n);if(x)return x;
  const c=soget.filter(a=>{const q=eqv(a.matricola);return q.length>=5&&n.length>=5&&(q.endsWith(n)||n.endsWith(q))});
  return c.length===1?c[0]:null;
}
async function signedUrl(path){
  if(!path||!sb)return "";
  const {data}=await sb.storage.from("meter-photos").createSignedUrl(path,3600);
  return data?.signedUrl||"";
}
async function hydratePhotoUrls(rows){
  for(const r of rows) r._url=r.photo_path?await signedUrl(r.photo_path):(r.photo_url||"");
}
async function loadRecords(){
  if(!sb||!currentUser){records=[];renderAll();return}
  const {data,error}=await sb.from("meter_readings").select("*").order("captured_at",{ascending:false});
  if(error){console.error(error);return}
  records=data||[];await hydratePhotoUrls(records);renderAll();
}
function renderAll(){renderStats();renderList();renderMap()}
function renderStats(){
  $("#nPhotos").textContent=records.length;
  $("#nGps").textContent=records.filter(r=>r.latitude!=null&&r.longitude!=null).length;
  $("#nMatched").textContent=records.filter(r=>r.soget_id).length;
  $("#nReview").textContent=records.filter(r=>r.needs_review).length;
  if(records.length){
    const d=[...records].sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));
    $("#summary").innerHTML=`${records.length} rilevazioni · ${records.filter(r=>r.soget_live_status==="READ").length} già lette su SO.G.E.T.<br>
    <span class="small">Prima: ${new Date(d[0].captured_at).toLocaleString("it-IT")} · Ultima: ${new Date(d.at(-1).captured_at).toLocaleString("it-IT")}</span>`;
  }else $("#summary").textContent="Nessuna foto caricata.";
}
function renderMap(){
  if(!map)return;markers.forEach(m=>map.removeLayer(m));markers=[];
  for(const r of records.filter(x=>x.latitude!=null&&x.longitude!=null)){
    const m=L.marker([r.latitude,r.longitude]).addTo(map);
    m.bindPopup(`${badge(r.soget_live_status)}<br><b>${esc(r.meter_serial||"Matricola da verificare")}</b><br>${esc(r.owner||"")}<br>${esc(r.address||"")}<br>${r.reading_m3??""} m³`);
    markers.push(m);
  }
  if(markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(.12));
}
function renderList(){
  const q=norm($("#search")?.value||"");
  const rows=records.filter(r=>!q||norm([r.meter_serial,r.owner,r.address,r.reading_m3].join(" ")).includes(q));
  $("#list").innerHTML=rows.length?rows.map(r=>`
  <div class="item">
    <img class="thumb" src="${esc(r._url||"")}">
    <div>${badge(r.soget_live_status)}
      <div><b>${esc(r.meter_serial||"Matricola da verificare")}</b></div>
      <div class="small">${esc(r.owner||"")} · ${esc(r.address||"")}</div>
      <div class="small">${new Date(r.captured_at).toLocaleString("it-IT")}
      ${r.soget_live_checked_at?` · live ${new Date(r.soget_live_checked_at).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}`:""}</div>
    </div>
    <button onclick="window.openEdit('${r.id}')">Apri</button>
  </div>`).join(""):'<div class="small">Nessun elemento.</div>';
}
async function callLive(meters){
  const r=await fetch("/api/soget-status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({meters})});
  const x=await r.json();if(!r.ok||!x.ok)throw new Error(x.error||"Errore SO.G.E.T.");return x;
}
async function saveLiveResult(record,result,checkedAt){
  if(!sb||!record)return;
  const patch={
    soget_live_status:result.status||"ERROR",
    soget_is_read:result.found?!!result.isRead:null,
    soget_is_illegible:result.found?!!result.illegible:null,
    soget_server_meter:result.serverMeter||null,
    soget_last_reading:(result.lastReading!==""&&result.lastReading!=null)?Number(result.lastReading):null,
    soget_last_reading_at:result.lastReadingDate||null,
    soget_id_rilevazione:result.idRilevazione||null,
    soget_live_checked_at:checkedAt||new Date().toISOString()
  };
  if(result.found){
    patch.soget_id=result.idUtenza||record.soget_id||null;
    patch.owner=result.owner||record.owner||null;
    patch.address=[result.address,result.civico].filter(Boolean).join(" ")||record.address||null;
    patch.user_code=result.codice||record.user_code||null;
  }
  await sb.from("meter_readings").update(patch).eq("id",record.id);
  Object.assign(record,patch);
}

async function sogetLiveLookup(){
  const meter=$("#sogetLiveMeter").value.trim();
  const box=$("#sogetLiveResult");
  if(meter.length<3){box.innerHTML='<span class="warn">Inserisci almeno 3 caratteri.</span>';return}
  box.textContent="Controllo SO.G.E.T.…";
  try{
    const x=await callLive([meter]);
    const r=x.results?.[0];
    if(!r){box.innerHTML='<span class="warn">Nessuna risposta.</span>';return}
    if(r.status==="READ"){
      box.innerHTML=`${badge("READ")}<div class="small" style="margin-top:6px">${esc(r.serverMeter||meter)} · ${esc(r.owner||"")}<br>${esc(r.address||"")} ${esc(r.civico||"")}<br>Ultima lettura: ${esc(r.lastReading||"-")} · ${esc(r.lastReadingDate||"-")}</div>`;
    }else if(r.status==="UNREAD"){
      box.innerHTML=`${badge("UNREAD")}<div class="small" style="margin-top:6px">${esc(r.serverMeter||meter)} · ${esc(r.owner||"")}<br>${esc(r.address||"")} ${esc(r.civico||"")}<br>Ultima lettura: ${esc(r.lastReading||"-")} · ${esc(r.lastReadingDate||"-")}</div>`;
    }else if(r.status==="ILLEGIBLE"){
      box.innerHTML=`${badge("ILLEGIBLE")}<div class="small" style="margin-top:6px">${esc(r.serverMeter||meter)} · ${esc(r.owner||"")}<br>${esc(r.address||"")} ${esc(r.civico||"")}</div>`;
    }else if(r.status==="NOT_FOUND"){
      box.innerHTML=`${badge("NOT_FOUND")}`;
    }else{
      box.innerHTML=`${badge(r.status||"ERROR")}<div class="small">${esc(r.error||"")}</div>`;
    }
  }catch(e){
    box.innerHTML=`<span class="warn">Errore: ${esc(e.message)}</span>`;
  }
}

async function refreshRecordsLive(rows,show=true){
  const targets=rows.filter(r=>String(r.meter_serial||"").trim().length>=3);
  if(!targets.length)return;
  if(show)$("#refreshLiveMsg").textContent=`Controllo SO.G.E.T. di ${targets.length} matricole…`;
  $("#liveStatus").textContent="SO.G.E.T. controllo…";
  try{
    for(let i=0;i<targets.length;i+=25){
      const batch=targets.slice(i,i+25);
      const x=await callLive(batch.map(r=>r.meter_serial));
      for(const result of x.results){
        const rec=batch.find(r=>eqv(r.meter_serial)===eqv(result.meter));
        if(rec)await saveLiveResult(rec,result,x.checkedAt);
      }
    }
    $("#liveStatus").textContent="SO.G.E.T. LIVE ✓";
    if(show)$("#refreshLiveMsg").textContent=`Aggiornato alle ${new Date().toLocaleTimeString("it-IT")}`;
    renderAll();
  }catch(e){
    $("#liveStatus").textContent="SO.G.E.T. errore";
    if(show)$("#refreshLiveMsg").textContent=e.message;
  }
}
async function uploadOne(file){
  $("#uploadStatus").textContent=`Analisi ${file.name}…`;

  // Start metadata request and OCR in parallel.
  const form=new FormData(); form.append("file",file,file.name);
  const metaPromise=fetch("/api/metadata",{method:"POST",body:form}).then(async r=>{
    const x=await r.json(); if(!r.ok)throw new Error(x.error||"Metadata error"); return x;
  });
  const ocrPromise=recognizeMeterPhoto(file);

  const [md,ocr]=await Promise.all([metaPromise,ocrPromise]);
  console.log("GPS metadata",md);

  $("#uploadStatus").textContent=`${file.name}: ${ocr.meter||"matricola ?"} · ${ocr.reading??"lettura ?"} m³ · caricamento…`;

  const path=`${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}-${file.name}`;
  const up=await sb.storage.from("meter-photos").upload(path,file,{contentType:file.type||"application/octet-stream"});
  if(up.error)throw up.error;

  let captured=new Date(file.lastModified||Date.now()).toISOString();
  if(md.date){
    const d=new Date(String(md.date).replace(/^(\d{4}):(\d{2}):(\d{2})/,"$1-$2-$3"));
    if(!isNaN(d))captured=d.toISOString();
  }

  const u=ocr.matchedUser;
  const row={
    captured_at:captured,
    latitude:md.lat,longitude:md.lng,gps_accuracy:md.accuracy,
    original_filename:file.name,photo_path:path,
    meter_serial:ocr.meter||null,
    reading_m3:ocr.reading,
    owner:u?.intestatario||null,
    address:u?[u.indirizzo,u.civico].filter(Boolean).join(" "):null,
    user_code:u?.codice||null,
    soget_id:u?.idUtenza||null,
    needs_review:!!ocr.review,
    notes:null,
    soget_live_status:null
  };

  const ins=await sb.from("meter_readings").insert(row).select().single();
  if(ins.error)throw ins.error;

  // Immediately ask the live SO.G.E.T. server when a serial was recognised.
  if(ins.data?.meter_serial){
    try{ await refreshRecordsLive([ins.data],false); }catch(e){ console.warn("Live SOGET",e); }
  }
  return ins.data;
}
$("#uploadBtn").onclick=async()=>{
  const files=[...$("#files").files];if(!files.length)return;
  $("#uploadBtn").disabled=true;
  try{for(let i=0;i<files.length;i++){ $("#uploadStatus").textContent=`${i+1}/${files.length} · ${files[i].name}`;await uploadOne(files[i])}
    $("#uploadStatus").textContent=`Completato: ${files.length} foto analizzate.`;await loadRecords();
  }catch(e){$("#uploadStatus").textContent="Errore: "+e.message}finally{$("#uploadBtn").disabled=false}
};
window.openEdit=async id=>{
  editing=records.find(r=>String(r.id)===String(id));if(!editing)return;
  $("#prev").src=editing._url||"";
  $("#meter").value=editing.meter_serial||"";$("#reading").value=editing.reading_m3??"";
  $("#owner").value=editing.owner||"";$("#address").value=editing.address||"";$("#notes").value=editing.notes||"";
  $("#liveBox").innerHTML=`${badge(editing.soget_live_status)}<div class="small">Ultimo controllo: ${editing.soget_live_checked_at?new Date(editing.soget_live_checked_at).toLocaleString("it-IT"):"mai"}</div>`;
  $("#dlg").showModal();
  if(editing.meter_serial){
    await refreshRecordsLive([editing],false);
    $("#liveBox").innerHTML=`${badge(editing.soget_live_status)}
      <div class="small">SO.G.E.T.: ultima lettura ${esc(editing.soget_last_reading??"-")} · ${esc(editing.soget_last_reading_at||"-")}<br>
      Controllato ${new Date(editing.soget_live_checked_at).toLocaleString("it-IT")}</div>`;
  }
};
$("#saveBtn").onclick=async()=>{
  if(!editing||!sb)return;
  const meter=$("#meter").value.trim(),m=matchMeter(meter);
  const patch={meter_serial:meter||null,reading_m3:$("#reading").value?Number($("#reading").value):null,
    owner:m?.intestatario||$("#owner").value.trim()||null,address:m?[m.indirizzo,m.civico].filter(Boolean).join(" "):$("#address").value.trim()||null,
    user_code:m?.codice||null,soget_id:m?.idUtenza||null,notes:$("#notes").value.trim()||null,needs_review:!(meter&&$("#reading").value&&m),
    soget_live_status:null,soget_live_checked_at:null};
  const {error}=await sb.from("meter_readings").update(patch).eq("id",editing.id);
  if(!error){Object.assign(editing,patch);await refreshRecordsLive([editing],false);$("#dlg").close();await loadRecords()}
};
$("#refreshLiveBtn").onclick=()=>refreshRecordsLive(records,true);
$("#sogetLiveBtn").onclick=sogetLiveLookup;
$("#sogetLiveMeter").addEventListener("keydown",e=>{if(e.key==="Enter")sogetLiveLookup()});
$("#search").oninput=renderList;
$("#sogetSearch").oninput=()=>{
  const q=norm($("#sogetSearch").value);
  if(q.length<2){$("#sogetResults").innerHTML='<div class="small">Digita almeno 2 caratteri.</div>';return}
  const out=soget.filter(x=>norm([x.matricola,x.intestatario,x.indirizzo,x.codice].join(" ")).includes(q)).slice(0,80);
  $("#sogetResults").innerHTML=out.map(x=>`<div style="padding:8px 0;border-bottom:1px solid #1b3049"><b>${esc(x.matricola)}</b> · ${esc(x.intestatario)}<div class="small">${esc(x.indirizzo)} · ultima cache ${esc(x.ultimaLettura)}</div></div>`).join("");
};
$$(".tab").forEach(b=>b.onclick=()=>{$$(".tab").forEach(x=>x.classList.remove("active"));$$(".panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#"+b.dataset.p).classList.add("active");if(b.dataset.p==="mapPage")setTimeout(()=>{if(map){map.invalidateSize();renderMap()}},60)});

async function showAuth(session){
  currentUser=session?.user||null;
  $("#authBox").style.display=currentUser?"none":"block";
  $("#appBody").style.display=currentUser?"block":"none";
  $("#logoutBtn").style.display=currentUser?"block":"none";
  $("#status").textContent=currentUser?currentUser.email:"Non autenticato";
  if(currentUser){
    await loadRecords();
    const stale=records.filter(r=>r.meter_serial && (!r.soget_live_checked_at || Date.now()-new Date(r.soget_live_checked_at).getTime()>5*60*1000));
    if(stale.length) refreshRecordsLive(stale.slice(0,100),false);
    clearInterval(liveTimer);
    liveTimer=setInterval(()=>{
      const visible=records.filter(r=>r.meter_serial).slice(0,100);
      if(visible.length)refreshRecordsLive(visible,false);
    },5*60*1000);
  }else{clearInterval(liveTimer)}
}
$("#loginBtn").onclick=async()=>{
  if(!sb)return;
  $("#loginMsg").textContent="Accesso…";
  const {data,error}=await sb.auth.signInWithPassword({email:$("#loginEmail").value.trim(),password:$("#loginPassword").value});
  $("#loginMsg").textContent=error?error.message:"";
  if(data?.session)await showAuth(data.session);
};
$("#logoutBtn").onclick=async()=>{await sb.auth.signOut();await showAuth(null)};
$("#diagBtn").onclick=runDiagnostics;
$("#deepDiagBtn").onclick=runDeepDiagnostics;

window.addEventListener("error", e=>{
  console.error("JS ERROR:",e.error||e.message);
  const out=$("#diagOut");
  if(out) out.innerHTML=`❌ Errore JavaScript: ${esc(e.message||"errore sconosciuto")}`;
});

(async()=>{
  $("#status").textContent="Avvio…";

  // Buttons/tabs have already been wired above. Now configure services.
  const configured=await loadRuntimeConfig();

  try{ initMap(); }catch(e){ console.error("Mappa:",e); }

  await runDiagnostics();

  if(!configured){
    $("#status").textContent="Supabase non configurato";
    $("#authBox").style.display="block";
    $("#appBody").style.display="block";
    $("#loginMsg").innerHTML=
      'Mancano <b>SUPABASE_URL</b> o <b>SUPABASE_ANON_KEY</b> nelle Environment Variables di Vercel.';
    return;
  }

  $("#status").textContent="Supabase ✓";

  await loadSoget();

  try{
    const {data:{session},error}=await sb.auth.getSession();
    if(error) throw error;
    await showAuth(session);
    sb.auth.onAuthStateChange((_e,s)=>showAuth(s));
  }catch(e){
    console.error("Auth:",e);
    $("#status").textContent="Errore Supabase";
    $("#authBox").style.display="block";
    $("#appBody").style.display="block";
    $("#loginMsg").textContent=e.message;
  }
})();