import React, { useRef, useState } from "react";
import { Download, Upload, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { BACKUP_TABLES as TABLES, buildBackup } from "../lib/backup";

function downloadJson(data:any,name:string){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
}
function cleanRows(table:string, rows:any[]){
  if(table==="products") return rows.map(({stock_available,...r})=>r);
  return rows;
}

export default function Respaldo(){
  const [busy,setBusy]=useState(false); const [msg,setMsg]=useState(""); const input=useRef<HTMLInputElement>(null);
  async function descargar(){
    setBusy(true); setMsg("Preparando respaldo…");
    try{
      const backup=await buildBackup();
      const stamp=backup.created_at.replace(/[:.]/g,"-");
      downloadJson(backup,`LOVE-STORIES-RESPALDO-${stamp}.json`);
      setMsg("✓ Respaldo descargado. Guárdalo en una carpeta segura y, si puedes, en una segunda unidad.");
    }catch(e:any){setMsg(`Error: ${e.message}`)}finally{setBusy(false)}
  }
  async function restaurar(file:File){
    setBusy(true); setMsg("Leyendo respaldo…");
    try{
      const backup=JSON.parse(await file.text());
      if(backup?.format!=="loves-stories-backup" || !backup.tables) throw new Error("El archivo no es un respaldo válido de Loves Stories.");
      const palabra=window.prompt("ATENCIÓN: restaurar reemplazará los datos actuales del negocio por los del respaldo. Escribe RESTAURAR para continuar.");
      if(palabra!=="RESTAURAR"){setMsg("Restauración cancelada. No se modificó nada.");return;}
      // Borra únicamente datos del negocio. Nunca toca auth.users ni profiles.
      for(const t of DELETE_ORDER){
        const {error}=await supabase.from(t).delete().not("id","is",null);
        if(error) throw new Error(`No se pudo limpiar ${t}: ${error.message}`);
      }
      for(const t of TABLES){
        const rows=cleanRows(t,backup.tables[t]||[]); if(!rows.length) continue;
        if(t==="app_settings"){
          const {error}=await supabase.from(t).upsert(rows); if(error) throw new Error(`${t}: ${error.message}`);
        }else{
          for(let i=0;i<rows.length;i+=200){ const {error}=await supabase.from(t).insert(rows.slice(i,i+200)); if(error) throw new Error(`${t}: ${error.message}`); }
        }
        setMsg(`Restaurando ${t}…`);
      }
      setMsg("✓ Restauración terminada. Recarga Loves Stories para ver los datos.");
    }catch(e:any){setMsg(`ERROR DE RESTAURACIÓN: ${e.message}. No sigas trabajando hasta revisar este mensaje.`)}finally{setBusy(false); if(input.current) input.current.value="";}
  }
  return <div className="p-4 mb-5" style={{background:'#F7F3EC',border:'1px solid #D9D0C2'}}>
    <div className="flex items-center gap-2 mb-2"><ShieldCheck size={18}/><p className="font-serif text-base">Respaldo de Loves Stories</p></div>
    <p className="text-xs mb-3" style={{color:'#5B4E5E'}}>El sistema guarda automáticamente una copia privada cada 15 minutos y antes de cerrar sesión. Este botón permite además descargar una copia a tu PC. No incluye contraseñas ni claves de Supabase.</p>
    <div className="flex gap-2 flex-wrap">
      <button disabled={busy} onClick={descargar} className="px-4 py-2 rounded text-sm flex items-center gap-2" style={{background:'#9C7A3C',color:'white'}}><Download size={15}/>{busy?'Procesando…':'Descargar respaldo'}</button>
      <button disabled={busy} onClick={()=>input.current?.click()} className="px-4 py-2 rounded text-sm flex items-center gap-2" style={{background:'#7A2540',color:'white'}}><Upload size={15}/>Restaurar respaldo</button>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={e=>e.target.files?.[0]&&restaurar(e.target.files[0])}/>
    </div>
    <div className="flex gap-2 mt-3 text-xs" style={{color:'#7A2540'}}><AlertTriangle size={14} className="shrink-0"/><span>No uses “Restaurar” para una copia diaria normal. Solo se usa para recuperar información perdida.</span></div>
    {msg&&<p className="text-xs mt-3" style={{color:'#5B4E5E'}}>{msg}</p>}
  </div>
}
