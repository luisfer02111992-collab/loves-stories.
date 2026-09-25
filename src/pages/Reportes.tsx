import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, FileDown, FileSpreadsheet, Users, Search } from "lucide-react";
import { jsPDF } from "jspdf";
import ExcelJS from "exceljs";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import StatCard from "../components/StatCard";

type Periodo="dia"|"mes"|"anio"|"rango";
type ClienteResumen={id:string;nombre:string;telefono:string;ventas:number;unidades:number;acumulado:number;costo:number;ganancia:number;margen:number};
type Detalle={fecha:string;cliente:string;telefono:string;codigo:string;producto:string;cantidad:number;costoUnit:number;precioUnit:number;venta:number;costo:number;ganancia:number;margen:number};
const money=(n:number)=>`Bs ${Number(n||0).toLocaleString("es-BO",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const num=(n:number)=>Number(n||0).toLocaleString("es-BO");
function inicioPeriodo(p:Periodo){const d=new Date();if(p==="dia")d.setHours(0,0,0,0);if(p==="mes"){d.setDate(1);d.setHours(0,0,0,0)}if(p==="anio"){d.setMonth(0,1);d.setHours(0,0,0,0)}return d.toISOString()}
function tituloPeriodo(p:Periodo,desde?:string,hasta?:string){const d=new Date();if(p==="rango")return `${desde||"—"} al ${hasta||"—"}`;if(p==="dia")return d.toLocaleDateString("es-BO",{day:"2-digit",month:"long",year:"numeric"});if(p==="mes")return d.toLocaleDateString("es-BO",{month:"long",year:"numeric"});return String(d.getFullYear())}
function hexRgb(hex:string){const h=hex.replace("#","");return [parseInt(h.slice(0,2),16)||64,parseInt(h.slice(2,4),16)||91,parseInt(h.slice(4,6),16)||155] as [number,number,number]}

export default function Reportes(){
 const [periodo,setPeriodo]=useState<Periodo>("mes"),[vista,setVista]=useState<"general"|"clientes">("general");
 const hoy=new Date().toISOString().slice(0,10); const [desde,setDesde]=useState("2025-10-19"),[hasta,setHasta]=useState(hoy);
 const [rangoDesde,setRangoDesde]=useState("2025-10-19"),[rangoHasta,setRangoHasta]=useState(hoy),[cargando,setCargando]=useState(false),[errorCarga,setErrorCarga]=useState("");
 const [detalle,setDetalle]=useState<Detalle[]>([]),[clientes,setClientes]=useState<ClienteResumen[]>([]),[porFecha,setPorFecha]=useState<any[]>([]),[porCategoria,setPorCategoria]=useState<any[]>([]);
 const [estilo,setEstilo]=useState("bar"),[color1,setColor1]=useState("#405B9B"),[color2,setColor2]=useState("#8AA05A"),[cobrado,setCobrado]=useState(0);
 useEffect(()=>{cargar()},[periodo,rangoDesde,rangoHasta]);
 useEffect(()=>{cargarPreferencias();const f=()=>cargarPreferencias();window.addEventListener("loves-chart-style-changed",f);return()=>window.removeEventListener("loves-chart-style-changed",f)},[]);
 async function cargarPreferencias(){const {data}=await supabase.from("app_settings").select("chart_style,report_primary_color,report_secondary_color").eq("id",1).single();setEstilo(data?.chart_style??localStorage.getItem("loves_chart_style")??"bar");setColor1(data?.report_primary_color??"#405B9B");setColor2(data?.report_secondary_color??"#8AA05A")}
 async function cargar(){
  setCargando(true); setErrorCarga("");
  try{
   // 1) Cargar primero las ventas cerradas. No dependemos de un join grande para encontrarlas.
   const ordenes:any[]=[]; let from=0; const pageSize=500;
   while(true){
    let q=supabase.from("orders")
      .select("id,customer_id,closed_at,total_cerrado,customers(name,phone)")
      .eq("status","closed");
    if(periodo==="rango"){
      q=q.gte("closed_at",`${rangoDesde}T00:00:00`).lte("closed_at",`${rangoHasta}T23:59:59.999`);
    }else{
      q=q.gte("closed_at",inicioPeriodo(periodo));
    }
    const {data:page,error}=await q.order("closed_at",{ascending:true}).range(from,from+pageSize-1);
    if(error) throw error;
    const part=page??[]; ordenes.push(...part);
    if(part.length<pageSize) break;
    from+=pageSize;
   }

   const ids=ordenes.map((o:any)=>o.id);
   const itemsPorOrden:Record<string,any[]>={};

   // 2) Cargar el detalle por bloques. Esto evita que un join anidado grande deje fuera
   // ventas históricas o se vuelva muy lento.
   for(let i=0;i<ids.length;i+=100){
    const lote=ids.slice(i,i+100);
    const {data:its,error}=await supabase.from("order_items")
      .select("order_id,quantity,unit_price,products(code,name,cost)")
      .in("order_id",lote);
    if(error) throw error;
    (its??[]).forEach((it:any)=>{
      (itemsPorOrden[it.order_id]??=[]).push(it);
    });
   }

   const rows:Detalle[]=[];
   const cli:Record<string,ClienteResumen>={};
   const fechas:Record<string,{fecha:string;ventas:number;ganancia:number;unidades:number}>={};
   const cats:Record<string,{cat:string;ventas:number;ganancia:number;unidades:number}>={};

   ordenes.forEach((o:any)=>{
    let ventaItems=0,costoOrden=0,unOrden=0;
    const its=itemsPorOrden[o.id]??[];

    its.forEach((it:any)=>{
      const q=Number(it.quantity||0),pu=Number(it.unit_price||0),desc=0,cu=Number(it.products?.cost||0);
      const venta=q*Math.max(0,pu-desc),cost=q*cu,gan=venta-cost;
      ventaItems+=venta;costoOrden+=cost;unOrden+=q;
      rows.push({
        fecha:new Date(o.closed_at).toLocaleString("es-BO"),
        cliente:o.customers?.name??"Sin cliente",telefono:o.customers?.phone??"",
        codigo:it.products?.code??"",producto:it.products?.name??"",cantidad:q,
        costoUnit:cu,precioUnit:Math.max(0,pu-desc),venta,costo:cost,ganancia:gan,
        margen:venta?gan/venta*100:0
      });
      const nombreProd=String(it.products?.name??"").toUpperCase();
      const cat=nombreProd.includes("ANILLO")?"Anillos":nombreProd.includes("ARETE")?"Aretes":nombreProd.includes("PULSERA")?"Pulseras":nombreProd.includes("CADENA")?"Cadenas":nombreProd.includes("COLLAR")?"Collares":nombreProd.includes("DIJE")?"Dijes":nombreProd.includes("SET")||nombreProd.includes("JUEGO")?"Sets":"Otros";
      if(!cats[cat])cats[cat]={cat,ventas:0,ganancia:0,unidades:0};
      cats[cat].ventas+=venta;cats[cat].ganancia+=gan;cats[cat].unidades+=q;
    });

    // El total oficial de la venta es total_cerrado. Para las ventas históricas
    // importadas no obligamos al reporte a depender del detalle para sumar la venta.
    const ventaOrden=Number(o.total_cerrado??0) || ventaItems;

    const k=periodo==="dia"
      ?new Date(o.closed_at).toLocaleTimeString("es-BO",{hour:"2-digit",minute:"2-digit"})
      :periodo==="mes"
      ?new Date(o.closed_at).toLocaleDateString("es-BO",{day:"2-digit"})
      :periodo==="rango"
      ?new Date(o.closed_at).toLocaleDateString("es-BO",{day:"2-digit",month:"2-digit",year:"2-digit"})
      :new Date(o.closed_at).toLocaleDateString("es-BO",{month:"short"});

    if(!fechas[k])fechas[k]={fecha:k,ventas:0,ganancia:0,unidades:0};
    fechas[k].ventas+=ventaOrden;fechas[k].ganancia+=ventaOrden-costoOrden;fechas[k].unidades+=unOrden;

    const id=o.customer_id??`sin-${o.id}`;
    if(!cli[id])cli[id]={id,nombre:o.customers?.name??"Sin cliente",telefono:o.customers?.phone??"",ventas:0,unidades:0,acumulado:0,costo:0,ganancia:0,margen:0};
    cli[id].ventas++;cli[id].unidades+=unOrden;cli[id].acumulado+=ventaOrden;cli[id].costo+=costoOrden;cli[id].ganancia+=ventaOrden-costoOrden;
   });

   Object.values(cli).forEach(x=>x.margen=x.acumulado?x.ganancia/x.acumulado*100:0);
   setDetalle(rows);setClientes(Object.values(cli).sort((a,b)=>b.acumulado-a.acumulado));
   setPorFecha(Object.values(fechas));setPorCategoria(Object.values(cats).sort((a,b)=>b.ventas-a.ventas));

   if(ids.length){
    let totalPagos=0;
    for(let i=0;i<ids.length;i+=200){
      const {data:p,error}=await supabase.from("payments").select("amount").in("order_id",ids.slice(i,i+200));
      if(error) throw error;
      totalPagos+=(p??[]).reduce((a:number,x:any)=>a+Number(x.amount||0),0);
    }
    setCobrado(totalPagos);
   }else setCobrado(0);
  }catch(err:any){
   console.error(err);
   setErrorCarga(err?.message??"Error desconocido al cargar el reporte");
   setDetalle([]);setClientes([]);setPorFecha([]);setPorCategoria([]);setCobrado(0);
  }finally{
   setCargando(false);
  }
 }
 const ventas=useMemo(()=>clientes.reduce((a,x)=>a+x.acumulado,0),[clientes]),costo=useMemo(()=>clientes.reduce((a,x)=>a+x.costo,0),[clientes]),ganancia=ventas-costo,unidades=clientes.reduce((a,x)=>a+x.unidades,0),nVentas=clientes.reduce((a,x)=>a+x.ventas,0),margen=ventas?ganancia/ventas*100:0,promedio=nVentas?ventas/nVentas:0;
 function chart(data:any[],key="ventas",nameKey="fecha"){return <ResponsiveContainer width="100%" height="100%">{estilo==="line"?<LineChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey={nameKey}/><YAxis/><Tooltip formatter={(v:any)=>money(Number(v))}/><Line type="monotone" dataKey={key} stroke={color1} strokeWidth={3}/></LineChart>:estilo==="area"?<AreaChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey={nameKey}/><YAxis/><Tooltip formatter={(v:any)=>money(Number(v))}/><Area type="monotone" dataKey={key} stroke={color1} fill={color1} fillOpacity={.3}/></AreaChart>:estilo==="pie"?<PieChart><Pie data={data} dataKey={key} nameKey={nameKey} cx="50%" cy="45%" outerRadius={85} label>{data.map((_:any,i:number)=><Cell key={i} fill={i%2?color2:color1}/>)}</Pie><Tooltip formatter={(v:any)=>money(Number(v))}/><Legend/></PieChart>:<BarChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey={nameKey}/><YAxis/><Tooltip formatter={(v:any)=>money(Number(v))}/><Bar dataKey={key} fill={color1}/></BarChart>}</ResponsiveContainer>}
 function pdfGrafico(doc:jsPDF,data:any[],x:number,y:number,w:number,h:number,title:string,labelKey:string,valueKey:string){doc.setFont("helvetica","bold");doc.setFontSize(10);doc.text(title,x,y);const top=y+5;const max=Math.max(1,...data.map(d=>Number(d[valueKey]||0)));const bw=Math.max(3,(w-8)/Math.max(1,data.length));data.slice(0,18).forEach((d,i)=>{const bh=(Number(d[valueKey]||0)/max)*(h-18);const [r,g,b]=hexRgb(i%2?color2:color1);doc.setFillColor(r,g,b);doc.rect(x+4+i*bw,top+h-12-bh,Math.max(2,bw-1),bh,"F");doc.setFont("helvetica","normal");doc.setFontSize(6);doc.text(String(d[labelKey]).slice(0,7),x+4+i*bw,top+h-8,{angle:35})});doc.setDrawColor(210);doc.rect(x,top,w,h-4)}
 function exportarPdf(){
  const doc=new jsPDF({unit:"mm",format:"a4"});const [r,g,b]=hexRgb(color1);const [r2,g2,b2]=hexRgb(color2);let y=18;
  const header=()=>{doc.setFont("times","bolditalic");doc.setFontSize(23);doc.setTextColor(156,122,60);doc.text("Loves Stories",15,16);doc.setTextColor(r,g,b);doc.setFont("helvetica","bold");doc.setFontSize(16);doc.text(vista==="clientes"?"Informe de ventas por cliente":"Informe profesional de ventas",15,27);doc.setFontSize(9);doc.setTextColor(80);doc.text(`${periodo==="rango"?"Rango":periodo==="dia"?"Día":periodo==="mes"?"Mes":"Año"}: ${tituloPeriodo(periodo,rangoDesde,rangoHasta)}`,15,34);doc.setDrawColor(r,g,b);doc.line(15,38,195,38);y=46};header();
  if(vista==="general"){
   const cards=[['Ventas totales',money(ventas)],['Ganancia',money(ganancia)],['Margen',`${margen.toFixed(2)}%`],['Número de ventas',num(nVentas)],['Cantidad de productos',num(unidades)],['Costo mercadería',money(costo)],['Venta promedio',money(promedio)],['Cobrado',money(cobrado)]];cards.forEach((c,i)=>{const col=i%2,row=Math.floor(i/2);const x=15+col*91,yy=y+row*12;doc.setFillColor(col?r2:r,col?g2:g,col?b2:b);doc.roundedRect(x,yy,86,9,1,1,'F');doc.setTextColor(255);doc.setFontSize(8);doc.setFont('helvetica','bold');doc.text(String(c[0]),x+3,yy+4);doc.text(String(c[1]),x+83,yy+4,{align:'right'})});y+=55;pdfGrafico(doc,porFecha,15,y,86,50,"Ventas por período","fecha","ventas");pdfGrafico(doc,porCategoria,109,y,86,50,"Ventas por categoría","cat","ventas");y+=60;
   doc.setFont('helvetica','bold');doc.setTextColor(r,g,b);doc.setFontSize(11);doc.text('Detalle de ventas',15,y);y+=6;const heads=['Fecha','Cliente','Código','Producto','Cant.','Venta','Ganancia'];const xs=[15,42,78,98,139,154,180];doc.setFillColor(r,g,b);doc.rect(15,y-4,180,7,'F');doc.setTextColor(255);doc.setFontSize(7);heads.forEach((h,i)=>doc.text(h,xs[i],y));y+=5;doc.setTextColor(30);doc.setFont('helvetica','normal');for(const d of detalle){if(y>280){doc.addPage();header();y=48}doc.text(d.fecha.slice(0,16),15,y);doc.text(d.cliente.slice(0,16),42,y);doc.text(d.codigo.slice(0,10),78,y);doc.text(d.producto.slice(0,18),98,y);doc.text(String(d.cantidad),143,y,{align:'right'});doc.text(money(d.venta),172,y,{align:'right'});doc.text(money(d.ganancia),195,y,{align:'right'});y+=5}
  } else {doc.setFont('helvetica','bold');doc.setTextColor(r,g,b);doc.setFontSize(11);doc.text('Resumen por cliente',15,y);y+=7;const heads=['Cliente','Teléfono','Ventas','Unid.','Ventas Bs','Ganancia','Margen'];const xs=[15,55,91,111,132,162,192];doc.setFillColor(r,g,b);doc.rect(15,y-4,180,7,'F');doc.setTextColor(255);doc.setFontSize(7);heads.forEach((h,i)=>doc.text(h,xs[i],y,{align:i>1?'right':'left'}));y+=5;doc.setTextColor(30);doc.setFont('helvetica','normal');for(const c of clientes){if(y>280){doc.addPage();header();y=48}doc.text(c.nombre.slice(0,22),15,y);doc.text(c.telefono.slice(0,15),55,y);doc.text(String(c.ventas),91,y,{align:'right'});doc.text(String(c.unidades),111,y,{align:'right'});doc.text(money(c.acumulado),132,y,{align:'right'});doc.text(money(c.ganancia),162,y,{align:'right'});doc.text(`${c.margen.toFixed(1)}%`,192,y,{align:'right'});y+=5}}
  doc.save(`${vista==="clientes"?'ventas_por_cliente':'informe_ventas'}_${periodo}.pdf`)
 }
 async function exportarExcel(){
  const wb=new ExcelJS.Workbook();wb.creator="Loves Stories";const ws=wb.addWorksheet(`Informe ${periodo}`);const primary=color1.replace('#','').toUpperCase(),secondary=color2.replace('#','').toUpperCase();
  ws.mergeCells('A1:L1');ws.getCell('A1').value='LOVES STORIES — INFORME DE VENTAS';ws.getCell('A1').font={bold:true,size:18,color:{argb:'FFFFFFFF'}};ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+primary}};ws.getCell('A1').alignment={horizontal:'center'};
  ws.mergeCells('A2:L2');ws.getCell('A2').value=`${periodo==="rango"?'Rango':periodo==="dia"?'Día':periodo==="mes"?'Mes':'Año'}: ${tituloPeriodo(periodo,rangoDesde,rangoHasta)}`;ws.getCell('A2').font={bold:true};ws.getCell('A2').alignment={horizontal:'center'};
  const resumen=[['Ventas totales',ventas],['Ganancia',ganancia],['Margen',margen/100],['Número de ventas',nVentas],['Cantidad de productos',unidades],['Costo mercadería',costo],['Venta promedio',promedio],['Cobrado',cobrado]];resumen.forEach((x,i)=>{const row=4+Math.floor(i/2),col=i%2?7:1;ws.getCell(row,col).value=x[0] as string;ws.getCell(row,col).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getCell(row,col).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+(i%2?secondary:primary)}};ws.getCell(row,col+1).value=x[1] as number;if(x[0]==='Margen')ws.getCell(row,col+1).numFmt='0.00%';else if(['Número de ventas','Cantidad de productos'].includes(String(x[0])))ws.getCell(row,col+1).numFmt='0';else ws.getCell(row,col+1).numFmt='"Bs "#,##0.00'});
  let row=10;const headers=['Fecha','Cliente','Teléfono','Código','Producto','Cantidad','Costo unitario','Precio de venta','Venta total','Costo total','Ganancia','Margen %'];headers.forEach((h,i)=>{const c=ws.getCell(row,i+1);c.value=h;c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+primary}};c.alignment={horizontal:'center'}});detalle.forEach(d=>{row++;const vals=[d.fecha,d.cliente,d.telefono,d.codigo,d.producto,d.cantidad,d.costoUnit,d.precioUnit,d.venta,d.costo,d.ganancia,d.margen/100];vals.forEach((v,i)=>ws.getCell(row,i+1).value=v as any);[7,8,9,10,11].forEach(c=>ws.getCell(row,c).numFmt='"Bs "#,##0.00');ws.getCell(row,12).numFmt='0.00%'});ws.autoFilter={from:{row:10,column:1},to:{row:Math.max(10,row),column:12}};ws.views=[{state:'frozen',ySplit:10}];[18,24,16,14,28,11,16,16,16,16,16,12].forEach((w,i)=>ws.getColumn(i+1).width=w);
  const wc=wb.addWorksheet('Ventas por cliente');const ch=['Cliente','Teléfono','Número de ventas','Unidades','Ventas acumuladas','Costo acumulado','Ganancia','Margen %'];ch.forEach((h,i)=>{const c=wc.getCell(1,i+1);c.value=h;c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+primary}}});clientes.forEach((c,i)=>{const r=i+2;[c.nombre,c.telefono,c.ventas,c.unidades,c.acumulado,c.costo,c.ganancia,c.margen/100].forEach((v,j)=>wc.getCell(r,j+1).value=v as any);[5,6,7].forEach(k=>wc.getCell(r,k).numFmt='"Bs "#,##0.00');wc.getCell(r,8).numFmt='0.00%'});wc.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,clientes.length+1),column:8}};wc.views=[{state:'frozen',ySplit:1}];[28,18,16,12,18,18,18,12].forEach((w,i)=>wc.getColumn(i+1).width=w);
  const wg=wb.addWorksheet('Datos para gráficas');['Período','Ventas','Ganancia','Unidades'].forEach((h,i)=>{wg.getCell(1,i+1).value=h;wg.getCell(1,i+1).font={bold:true}});porFecha.forEach((d,i)=>{wg.addRow([d.fecha,d.ventas,d.ganancia,d.unidades])});wg.autoFilter={from:'A1',to:`D${Math.max(1,porFecha.length+1)}`};wg.getColumn(1).width=18;[2,3].forEach(c=>{wg.getColumn(c).width=16;wg.getColumn(c).numFmt='"Bs "#,##0.00'});wg.getColumn(4).width=12;
  const buf=await wb.xlsx.writeBuffer();const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`informe_ventas_${periodo}.xlsx`;a.click();URL.revokeObjectURL(a.href)
 }
 return <div>
  <div className="flex flex-wrap items-center justify-between gap-2 mb-4"><div className="flex gap-2"><button onClick={()=>setVista('general')} className="px-3 py-2 rounded-md text-sm flex gap-2 items-center" style={{background:vista==='general'?color1:'#F7F3EC',color:vista==='general'?'white':'#2B1E2E'}}><BarChart3 size={15}/>Reporte de ventas</button><button onClick={()=>setVista('clientes')} className="px-3 py-2 rounded-md text-sm flex gap-2 items-center" style={{background:vista==='clientes'?color1:'#F7F3EC',color:vista==='clientes'?'white':'#2B1E2E'}}><Users size={15}/>Ventas por cliente</button></div><div className="flex flex-wrap gap-2"><button onClick={exportarPdf} className="text-xs px-3 py-2 rounded-md flex gap-1 items-center text-white" style={{background:color1}}><FileDown size={14}/>Informe PDF</button><button onClick={exportarExcel} className="text-xs px-3 py-2 rounded-md flex gap-1 items-center text-white" style={{background:color2}}><FileSpreadsheet size={14}/>Informe Excel</button>{(['dia','mes','anio'] as Periodo[]).map(p=><button key={p} onClick={()=>setPeriodo(p)} className="text-xs px-3 py-2 rounded-md" style={{background:periodo===p?color1:'#F7F3EC',color:periodo===p?'white':'#5B4E5E'}}>{p==='dia'?'Día':p==='mes'?'Mes':'Año'}</button>)}<button onClick={()=>setPeriodo('rango')} className="text-xs px-3 py-2 rounded-md" style={{background:periodo==='rango'?color1:'#F7F3EC',color:periodo==='rango'?'white':'#5B4E5E'}}>Rango</button></div></div>
  {periodo==='rango'&&<div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded-lg bg-white border"><label className="text-xs">Desde<input type="date" value={desde} onChange={e=>setDesde(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(desde&&hasta&&hasta>=desde){setRangoDesde(desde);setRangoHasta(hasta)}}}} className="block mt-1 px-3 py-2 rounded border"/></label><label className="text-xs">Hasta<input type="date" value={hasta} min={desde} onChange={e=>setHasta(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(desde&&hasta&&hasta>=desde){setRangoDesde(desde);setRangoHasta(hasta)}}}} className="block mt-1 px-3 py-2 rounded border"/></label><button disabled={cargando||!desde||!hasta||hasta<desde} onClick={()=>{setRangoDesde(desde);setRangoHasta(hasta)}} className="px-4 py-2 rounded-md text-sm flex items-center gap-2 text-white disabled:opacity-50" style={{background:color1}}><Search size={15}/>{cargando?'Buscando…':'Buscar'}</button><span className="text-xs text-gray-500 pb-2">Mostrando: {tituloPeriodo(periodo,rangoDesde,rangoHasta)}</span></div>}
  {errorCarga&&<div className="mb-3 p-3 rounded border text-sm" style={{background:'#FDECEC',color:'#7A2540'}}>No se pudo cargar el reporte: {errorCarga}</div>}
  {vista==='general'?<><div className="rounded-lg p-5 mb-4 bg-white" style={{border:`1px solid ${color1}44`}}><div className="flex justify-between items-end mb-4"><div><h2 className="font-serif text-xl" style={{color:color1}}>Resumen de ventas</h2><p className="text-xs text-gray-500">{tituloPeriodo(periodo,rangoDesde,rangoHasta)}</p></div></div><div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><StatCard label="Ventas totales" value={money(ventas)} accent={color1}/><StatCard label="Ganancia" value={money(ganancia)} accent={color2}/><StatCard label="Margen de utilidad" value={`${margen.toFixed(2)}%`}/><StatCard label="Venta promedio" value={money(promedio)}/><StatCard label="Número de ventas" value={num(nVentas)}/><StatCard label="Cantidad de productos" value={num(unidades)}/><StatCard label="Costo mercadería" value={money(costo)}/><StatCard label="Cobrado" value={money(cobrado)}/></div></div><div className="grid lg:grid-cols-2 gap-4 mb-4"><section className="bg-white rounded-lg p-4 border"><h3 className="font-serif text-lg mb-3" style={{color:color1}}>Ventas por {periodo==='dia'?'hora':periodo==='anio'?'mes':'día'}</h3><div className="h-72">{chart(porFecha)}</div></section><section className="bg-white rounded-lg p-4 border"><h3 className="font-serif text-lg mb-3" style={{color:color1}}>Ventas por categoría</h3><div className="h-72">{chart(porCategoria,'ventas','cat')}</div></section></div><div className="bg-white rounded-lg overflow-auto border"><table className="w-full text-xs"><thead><tr style={{background:color1,color:'white'}}>{['Fecha','Cliente','Teléfono','Código','Producto','Cant.','Venta','Costo','Ganancia','Margen'].map(h=><th className="px-3 py-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{detalle.map((d,i)=><tr key={i} className="border-b"><td className="px-3 py-2">{d.fecha}</td><td>{d.cliente}</td><td>{d.telefono}</td><td>{d.codigo}</td><td>{d.producto}</td><td>{d.cantidad}</td><td>{money(d.venta)}</td><td>{money(d.costo)}</td><td>{money(d.ganancia)}</td><td>{d.margen.toFixed(1)}%</td></tr>)}</tbody></table></div></>:<div className="rounded-lg overflow-hidden bg-white border"><div className="p-5" style={{borderBottom:`3px solid ${color1}`}}><h2 className="font-serif text-xl" style={{color:color1}}>Reporte de ventas por cliente</h2><p className="text-xs text-gray-500">{tituloPeriodo(periodo,rangoDesde,rangoHasta)}</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr style={{background:color1,color:'white'}}>{['Cliente','Teléfono','Nº ventas','Unidades','Ventas acumuladas','Costo acumulado','Ganancia','Margen'].map(h=><th key={h} className="text-left px-4 py-3">{h}</th>)}</tr></thead><tbody>{clientes.map((c,i)=><tr key={c.id} style={{background:i%2?`${color2}12`:'white'}} className="border-b"><td className="px-4 py-3 font-medium">{c.nombre}</td><td>{c.telefono}</td><td>{c.ventas}</td><td>{c.unidades}</td><td>{money(c.acumulado)}</td><td>{money(c.costo)}</td><td>{money(c.ganancia)}</td><td>{c.margen.toFixed(2)}%</td></tr>)}</tbody></table></div></div>}
 </div>
}
