import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import StatCard from "../components/StatCard";

export default function CierreCaja(){
 const [fecha,setFecha]=useState(()=>new Date().toISOString().slice(0,10)); const [pagos,setPagos]=useState<any[]>([]); const [devs,setDevs]=useState<any[]>([]);
 useEffect(()=>{cargar()},[fecha]);
 async function cargar(){ const a=new Date(fecha+"T00:00:00").toISOString(), b=new Date(fecha+"T23:59:59").toISOString();
  const [{data:p},{data:d}]=await Promise.all([supabase.from("payments").select("amount,method,paid_at,customers(name),orders(order_number)").gte("paid_at",a).lte("paid_at",b),supabase.from("returns").select("total_amount,reason,type,created_at,customers(name),orders(order_number)").eq("status","activa").gte("created_at",a).lte("created_at",b)]); setPagos(p??[]); setDevs(d??[]); }
 const cobrado=pagos.reduce((a,p)=>a+Number(p.amount),0), devuelto=devs.reduce((a,d)=>a+Number(d.total_amount),0); const metodos=pagos.reduce((a:any,p:any)=>(a[p.method]=(a[p.method]||0)+Number(p.amount),a),{});
 return <div><div className="flex items-center justify-between mb-4"><p className="font-serif text-lg">Cierre de caja diario</p><input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} className="px-3 py-2 rounded"/></div>
 <div className="grid grid-cols-3 gap-3 mb-4"><StatCard label="Cobrado" value={`Bs ${cobrado.toFixed(2)}`}/><StatCard label="Devuelto" value={`Bs ${devuelto.toFixed(2)}`} accent="#7A2540"/><StatCard label="Caja neta" value={`Bs ${(cobrado-devuelto).toFixed(2)}`} accent="#4F6F52"/></div>
 <div className="p-4 mb-4" style={{background:"#F7F3EC",border:"1px solid #D9D0C2"}}><p className="font-serif mb-2">Cobros por método</p>{Object.entries(metodos).map(([m,v]:any)=><div className="flex justify-between text-sm py-1" key={m}><span>{m}</span><b>Bs {Number(v).toFixed(2)}</b></div>)}</div>
 <div className="p-4" style={{background:"#F7F3EC",border:"1px solid #D9D0C2"}}><p className="font-serif mb-2">Movimientos del día</p>{pagos.map((p,i)=><p className="text-xs py-1" key={'p'+i}>+ Bs {Number(p.amount).toFixed(2)} · {p.method} · {p.customers?.name??'Venta directa'} · pedido #{p.orders?.order_number??'—'}</p>)}{devs.map((d,i)=><p className="text-xs py-1" style={{color:'#7A2540'}} key={'d'+i}>− Bs {Number(d.total_amount).toFixed(2)} · {d.reason} · {d.customers?.name??'Cliente'}</p>)}</div></div>
}
