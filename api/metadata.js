
import { exiftool } from "exiftool-vendored";
import formidable from "formidable";
import fs from "fs";

export const config = { api: { bodyParser: false } };

function num(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"POST required"});
  const form=formidable({uploadDir:"/tmp",keepExtensions:true,maxFileSize:35*1024*1024});
  try{
    const [,files]=await form.parse(req);
    const f=Array.isArray(files.file)?files.file[0]:files.file;
    if(!f) return res.status(400).json({error:"file missing"});
    const tags=await exiftool.read(f.filepath);
    const lat=num(tags.GPSLatitude), lng=num(tags.GPSLongitude);
    const acc=num(tags.GPSHPositioningError);
    const dt=tags.DateTimeOriginal || tags.CreateDate || tags.ModifyDate || null;
    res.status(200).json({
      lat,lng,accuracy:acc,date:dt?String(dt):null,
      make:tags.Make||null,model:tags.Model||null,
      source:"ExifTool server"
    });
    try{fs.unlinkSync(f.filepath)}catch{}
  }catch(e){
    res.status(500).json({error:String(e?.message||e)});
  }
}
