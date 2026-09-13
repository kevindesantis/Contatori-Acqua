import formidable from "formidable";
import fs from "node:fs/promises";
import * as exifr from "exifr";

export const config={api:{bodyParser:false}};

function num(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function isoDate(v){
  if(!v)return null;
  try{
    const d=v instanceof Date?v:new Date(v);
    return Number.isNaN(d.getTime())?null:d.toISOString();
  }catch{return null}
}

export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST required"});
  let temp=null;
  try{
    const form=formidable({maxFileSize:50*1024*1024,keepExtensions:true});
    const [,files]=await form.parse(req);
    let f=files.file;
    if(Array.isArray(f))f=f[0];
    if(!f?.filepath)throw new Error("File non ricevuto");
    temp=f.filepath;

    const buf=await fs.readFile(f.filepath);

    let meta={};
    try{
      meta=await exifr.parse(buf,{
        gps:true,tiff:true,exif:true,ifd0:true,
        reviveValues:true,translateValues:true
      })||{};
    }catch(e){
      console.warn("EXIF parse:",e?.message||e);
    }

    let gps=null;
    try{gps=await exifr.gps(buf)}catch{}

    const lat=num(meta.latitude ?? gps?.latitude);
    const lng=num(meta.longitude ?? gps?.longitude);
    const accuracy=num(meta.GPSHPositioningError);

    const date=isoDate(
      meta.DateTimeOriginal ??
      meta.CreateDate ??
      meta.ModifyDate
    );

    return res.status(200).json({
      ok:true,
      lat,lng,accuracy,date,
      make:meta.Make||null,
      model:meta.Model||null,
      orientation:meta.Orientation||null,
      hasGps:lat!==null&&lng!==null
    });
  }catch(e){
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }finally{
    if(temp)try{await fs.unlink(temp)}catch{}
  }
}