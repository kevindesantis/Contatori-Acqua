
const cfg=window.APP_CONFIG||{};
const sb=(cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY)?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY):null;
let records=[],soget=[],map,markers=[],editing=null;

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const norm=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function initMap(){
  map=L.map("map").setView([38.89,16.75],12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:20,attribution:"© OpenStreetMap"}).addTo(map);
}
function setStatus(){
  $("#status").textContent=sb?"Supabase connesso":"Configura Supabase";
}
async function loadSoget(){
  try{
    const r=await fetch("/data/utenze.json");
    soget=await r.json();
  }catch{soget=[]}
}
function matchMeter(m){
  const n=norm(m); if(!n)return null;
  let exact=soget.find(x=>norm(x.matricola)===n); if(exact)return exact;
  const equiv=s=>norm(s).replaceAll("B","8").replaceAll("O","0").replaceAll("I","1").replaceAll("S","5").replaceAll("Z","2");
  exact=soget.find(x=>equiv(x.matricola)===equiv(m)); if(exact)return exact;
  const candidates=soget.filter(x=>{
    const a=equiv(x.matricola),b=equiv(m);
    return a.length>=5&&b.length>=5&&(a.endsWith(b)||b.endsWith(a));
  });
  return candidates.length===1?candidates[0]:null;
}
async function loadRecords(){
  if(!sb){records=[];renderAll();return}
  const {data,error}=await sb.from("meter_readings").select("*").order("captured_at",{ascending:false});
  if(!error)records=data||[];
  renderAll();
}
function renderAll(){renderStats();renderList();renderMap()}
function renderStats(){
  $("#nPhotos").textContent=records.length;
  $("#nGps").textContent=records.filter(r=>r.latitude!=null&&r.longitude!=null).length;
  $("#nMatched").textContent=records.filter(r=>r.soget_id).length;
  $("#nReview").textContent=records.filter(r=>r.needs_review).length;
  if(records.length){
    const d=[...records].sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));
    $("#summary").textContent=`${records.length} rilevazioni. Prima: ${new Date(d[0].captured_at).toLocaleString("it-IT")} · Ultima: ${new Date(d.at(-1).captured_at).toLocaleString("it-IT")}`;
  } else $("#summary").textContent="Nessuna foto caricata.";
}
function renderMap(){
  if(!map)return; markers.forEach(m=>map.removeLayer(m));markers=[];
  for(const r of records.filter(x=>x.latitude!=null&&x.longitude!=null)){
    const m=L.marker([r.latitude,r.longitude]).addTo(map);
    m.bindPopup(`<b>${esc(r.meter_serial||"Matricola da verificare")}</b><br>${esc(r.owner||"")}<br>${esc(r.address||"")}<br>${esc(r.reading_m3??"")} m³`);
    markers.push(m);
  }
  if(markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(.12));
}
function renderList(){
  const q=norm($("#search")?.value||"");
  const rows=records.filter(r=>!q||norm([r.meter_serial,r.owner,r.address,r.reading_m3].join(" ")).includes(q));
  $("#list").innerHTML=rows.length?rows.map(r=>`
  <div class="item">
    <img class="thumb" src="${esc(r.photo_url||"")}">
    <div><b>${esc(r.meter_serial||"Matricola da verificare")}</b>
    <div class="small">${esc(r.owner||"")} · ${esc(r.address||"")}</div>
    <div class="small">${new Date(r.captured_at).toLocaleString("it-IT")} ${r.needs_review?'<span class="warn">· verifica</span>':'<span class="ok">· ok</span>'}</div></div>
    <button onclick="window.openEdit('${r.id}')">Apri</button>
  </div>`).join(""):'<div class="small">Nessun elemento.</div>';
}
async function uploadOne(file){
  if(!sb) throw new Error("Supabase non configurato");
  const form=new FormData(); form.append("file",file,file.name);
  const md=await fetch("/api/metadata",{method:"POST",body:form}).then(async r=>{if(!r.ok)throw new Error((await r.json()).error||"Metadata error");return r.json()});
  const path=`${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}-${file.name}`;
  const up=await sb.storage.from("meter-photos").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
  if(up.error)throw up.error;
  const {data:pub}=sb.storage.from("meter-photos").getPublicUrl(path);
  const captured=md.date?new Date(String(md.date).replace(/^(\d{4}):(\d{2}):(\d{2})/,"$1-$2-$3")).toISOString():new Date(file.lastModified||Date.now()).toISOString();
  const row={
    captured_at:captured,latitude:md.lat,longitude:md.lng,gps_accuracy:md.accuracy,
    original_filename:file.name,photo_path:path,photo_url:pub.publicUrl,
    meter_serial:null,reading_m3:null,owner:null,address:null,user_code:null,
    soget_id:null,needs_review:true,notes:null
  };
  const ins=await sb.from("meter_readings").insert(row).select().single();
  if(ins.error)throw ins.error;
  return ins.data;
}
$("#uploadBtn").onclick=async()=>{
  const files=[...$("#files").files]; if(!files.length)return;
  $("#uploadBtn").disabled=true;
  try{
    for(let i=0;i<files.length;i++){
      $("#uploadStatus").textContent=`${i+1}/${files.length} · ${files[i].name}`;
      await uploadOne(files[i]);
    }
    $("#uploadStatus").textContent=`Completato: ${files.length} foto.`;
    await loadRecords();
  }catch(e){$("#uploadStatus").textContent="Errore: "+e.message}
  finally{$("#uploadBtn").disabled=false}
}
window.openEdit=async id=>{
  editing=records.find(r=>String(r.id)===String(id)); if(!editing)return;
  $("#prev").src=editing.photo_url||"";
  $("#meter").value=editing.meter_serial||"";$("#reading").value=editing.reading_m3??"";
  $("#owner").value=editing.owner||"";$("#address").value=editing.address||"";$("#notes").value=editing.notes||"";
  $("#dlg").showModal();
}
$("#saveBtn").onclick=async()=>{
  if(!editing||!sb)return;
  const meter=$("#meter").value.trim(); const m=matchMeter(meter);
  const patch={
    meter_serial:meter||null,reading_m3:$("#reading").value?Number($("#reading").value):null,
    owner:m?.intestatario||$("#owner").value.trim()||null,
    address:m?[m.indirizzo,m.civico].filter(Boolean).join(" "):$("#address").value.trim()||null,
    user_code:m?.codice||null,soget_id:m?.idUtenza||null,
    notes:$("#notes").value.trim()||null,needs_review:!(meter&&$("#reading").value&&m)
  };
  const {error}=await sb.from("meter_readings").update(patch).eq("id",editing.id);
  if(!error){$("#dlg").close();await loadRecords()}
}
$("#search").oninput=renderList;
$("#sogetSearch").oninput=()=>{
  const q=norm($("#sogetSearch").value);
  if(q.length<2){$("#sogetResults").innerHTML='<div class="small">Digita almeno 2 caratteri.</div>';return}
  const out=soget.filter(x=>norm([x.matricola,x.intestatario,x.indirizzo,x.codice].join(" ")).includes(q)).slice(0,80);
  $("#sogetResults").innerHTML=out.map(x=>`<div style="padding:8px 0;border-bottom:1px solid #1b3049"><b>${esc(x.matricola)}</b> · ${esc(x.intestatario)}<div class="small">${esc(x.indirizzo)} · ultima ${esc(x.ultimaLettura)}</div></div>`).join("");
}
$$(".tab").forEach(b=>b.onclick=()=>{$$(".tab").forEach(x=>x.classList.remove("active"));$$(".panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#"+b.dataset.p).classList.add("active");if(b.dataset.p==="mapPage")setTimeout(()=>{map.invalidateSize();renderMap()},60)});
(async()=>{setStatus();await loadSoget();initMap();await loadRecords()})();
