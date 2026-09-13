import formidable from "formidable";
import fs from "node:fs/promises";
import * as exifr from "exifr";
import ExifReader from "exifreader";

export const config={api:{bodyParser:false}};

function n(v){
  if(v==null)return null;
  if(typeof v==="number")return Number.isFinite(v)?v:null;
  if(typeof v==="object"){
    if(Number.isFinite(Number(v.value)))return Number(v.value);
    if(Array.isArray(v.value)&&v.value.length){
      const x=Number(v.value[0]); return Number.isFinite(x)?x:null;
    }
    if(Number.isFinite(Number(v.description)))return Number(v.description);
  }
  const x=Number(v);
  return Number.isFinite(x)?x:null;
}
function iso(v){
  if(!v)return null;
  if(v instanceof Date && !isNaN(v))return v.toISOString();
  const s=typeof v==="object"?(v.description||v.value||""):v;
  const m=String(s).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if(m){
    const d=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);
    if(!isNaN(d))return d.toISOString();
  }
  const d=new Date(s);
  return isNaN(d)?null:d.toISOString();
}
function rationalToNumber(v){
  if(v==null)return null;
  if(typeof v==="number")return v;
  if(Array.isArray(v)){
    if(v.length===3){
      const arr=v.map(x=>{
        if(typeof x==="number")return x;
        if(Array.isArray(x)&&x.length>=2)return Number(x[0])/Number(x[1]);
        if(x&&typeof x==="object"&&"numerator" in x)return Number(x.numerator)/Number(x.denominator);
        return Number(x);
      });
      if(arr.every(Number.isFinite))return arr[0]+arr[1]/60+arr[2]/3600;
    }
    if(v.length>=2 && Number(v[1])!==0)return Number(v[0])/Number(v[1]);
  }
  if(v&&typeof v==="object"&&"numerator" in v)return Number(v.numerator)/Number(v.denominator);
  return Number(v);
}
function exifReaderGps(tags){
  try{
    const latTag=tags.GPSLatitude, lngTag=tags.GPSLongitude;
    let lat = n(latTag?.description);
    let lng = n(lngTag?.description);
    if(lat==null) lat=rationalToNumber(latTag?.value);
    if(lng==null) lng=rationalToNumber(lngTag?.value);
    const latRef=String(tags.GPSLatitudeRef?.description||tags.GPSLatitudeRef?.value||"").toUpperCase();
    const lngRef=String(tags.GPSLongitudeRef?.description||tags.GPSLongitudeRef?.value||"").toUpperCase();
    if(lat!=null && latRef.includes("S"))lat=-Math.abs(lat);
    if(lng!=null && lngRef.includes("W"))lng=-Math.abs(lng);
    return {lat:Number.isFinite(lat)?lat:null,lng:Number.isFinite(lng)?lng:null};
  }catch{return {lat:null,lng:null}}
}

export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST required"});
  let tmp=null;
  try{
    const form=formidable({maxFileSize:60*1024*1024,keepExtensions:true});
    const [,files]=await form.parse(req);
    let f=files.file; if(Array.isArray(f))f=f[0];
    if(!f?.filepath)throw new Error("File non ricevuto");
    tmp=f.filepath;
    const buf=await fs.readFile(tmp);

    let lat=null,lng=null,accuracy=null,date=null,make=null,model=null,source=[];

    try{
      const x=await exifr.parse(buf,{gps:true,tiff:true,exif:true,ifd0:true,reviveValues:true,translateValues:true})||{};
      let g=null; try{g=await exifr.gps(buf)}catch{}
      lat=n(x.latitude ?? g?.latitude); lng=n(x.longitude ?? g?.longitude);
      accuracy=n(x.GPSHPositioningError);
      date=iso(x.DateTimeOriginal ?? x.CreateDate ?? x.ModifyDate);
      make=x.Make||null; model=x.Model||null;
      if(lat!=null&&lng!=null)source.push("exifr");
    }catch{}

    if(lat==null||lng==null||!date){
      try{
        const tags=ExifReader.load(buf,{expanded:false});
        const g=exifReaderGps(tags);
        if(lat==null)lat=g.lat;
        if(lng==null)lng=g.lng;
        if(!date)date=iso(tags.DateTimeOriginal ?? tags.CreateDate ?? tags.ModifyDate);
        if(!make)make=tags.Make?.description||null;
        if(!model)model=tags.Model?.description||null;
        if(g.lat!=null&&g.lng!=null)source.push("ExifReader");
      }catch(e){ console.warn("ExifReader",e?.message||e); }
    }

    return res.status(200).json({
      ok:true,lat,lng,accuracy,date,make,model,
      hasGps:lat!=null&&lng!=null,
      source:source.join("+")||"none"
    });
  }catch(e){
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }finally{
    if(tmp)try{await fs.unlink(tmp)}catch{}
  }
}