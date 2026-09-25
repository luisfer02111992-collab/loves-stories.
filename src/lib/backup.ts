import { supabase } from "./supabase";

export const BACKUP_TABLES = [
  "app_settings","categories","purchase_batches","products","price_history","pricing_rules",
  "customers","sellers","sales_sessions","orders","order_items","order_item_history","pdf_versions",
  "inventory_movements","payments","returns","return_items","catalog_products","catalog_reservations",
  "catalog_submissions","catalog_submission_items","audit_log","login_log"
] as const;

export async function readAllRows(table: string) {
  const out:any[]=[]; let from=0; const step=1000;
  while(true){
    const {data,error}=await supabase.from(table).select("*").range(from,from+step-1);
    if(error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data||[]));
    if(!data || data.length<step) break;
    from+=step;
  }
  return out;
}

export async function buildBackup(){
  const tables:Record<string,any[]>={};

  const results = await Promise.all(
    BACKUP_TABLES.map(async (t) => {
      const rows = await readAllRows(t);
      return [t, rows] as const;
    })
  );

  for (const [table, rows] of results) {
    tables[table] = rows;
  }

  const now=new Date();
  return {format:"loves-stories-backup",version:"1.1",created_at:now.toISOString(),tables};
}

export async function saveAutomaticBackup(reason:"periodico"|"cerrar_sesion"="periodico"){
  const backup=await buildBackup();
  const stamp=backup.created_at.replace(/[:.]/g,"-");
  const path=`automaticos/${stamp}-${reason}.json`;
  const body=new Blob([JSON.stringify({...backup,automatic:true,reason})],{type:"application/json"});
  const {error}=await supabase.storage.from("respaldos").upload(path,body,{contentType:"application/json",upsert:false});
  if(error) throw new Error(error.message);

  // Conserva los 30 respaldos automáticos más recientes para no crecer sin límite.
  const {data}=await supabase.storage.from("respaldos").list("automaticos",{limit:100,sortBy:{column:"created_at",order:"desc"}});
  if(data && data.length>30){
    const old=data.slice(30).map(x=>`automaticos/${x.name}`);
    if(old.length) await supabase.storage.from("respaldos").remove(old);
  }
  localStorage.setItem("loves_last_auto_backup", backup.created_at);
  return backup.created_at;
}
