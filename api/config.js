
export default function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  return res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  });
}
