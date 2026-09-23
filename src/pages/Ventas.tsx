import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Minus, Plus, Pencil, FileDown, RotateCcw, Undo2, Save, Printer, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSellerSession } from "../hooks/useSellerSession";
import { loadPricingRules, agruparPorProducto, PricingRule, LineaPedido } from "../lib/pricing";
import { generarPdfPedido, generarPdfGrande, generarPdfDevolucion } from "../lib/pdf";
import type { Devolucion, DevolucionItem } from "../lib/types";
import ExcelJS from "exceljs";

interface VentaCerrada {
  id: string;
  order_number: number;
  cliente: string;
  telefono: string;
  closed_at: string;
  total_cerrado: number | null;
  items: (LineaPedido & { descripcion?: string; costo?: number })[];
}

const MOTIVOS = ["Producto roto", "Producto defectuoso", "Producto equivocado", "Otro"];

export default function Ventas() {
  const { vendedorActivoId, sesionActivaId } = useSellerSession();
  const [cambiosSinGuardar, setCambiosSinGuardar] = useState<Set<string>>(new Set());
  const [cambiosPendientes, setCambiosPendientes] = useState<Record<string, Record<string,{delta:number;codigo:string;nombre:string}>>>({});
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [ventas, setVentas] = useState<VentaCerrada[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [vendedoresMapa, setVendedoresMapa] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState<string | null>(null);
  const [codigoNuevo, setCodigoNuevo] = useState("");
  const [cantidadNueva, setCantidadNueva] = useState(1);
  const [devoluciones, setDevoluciones] = useState<Record<string, (Devolucion & { items: DevolucionItem[] })[]>>({});
  const [pagos, setPagos] = useState<Record<string, number>>({});
  const [banner, setBanner] = useState<{ orderId: string; original: number; anterior: number; nuevo: number; pagado: number; diferencia: number } | null>(null);
  const [reciboVenta, setReciboVenta] = useState<string | null>(null);
  const [mostrarDevolucion, setMostrarDevolucion] = useState<string | null>(null);
  const [devItemId, setDevItemId] = useState("");
  const [devCantidad, setDevCantidad] = useState(1);
  const [devMonto, setDevMonto] = useState(0);
  const [devMotivo, setDevMotivo] = useState(MOTIVOS[0]);
  const [devRestock, setDevRestock] = useState<"si" | "no" | "">("");
  const [devObs, setDevObs] = useState("");

  useEffect(() => {
    loadPricingRules().then(setReglas);
    supabase.from("sellers").select("id, name").then(({ data }) => {
      const mapa: Record<string, string> = {};
      (data ?? []).forEach((v: any) => (mapa[v.id] = v.name));
      setVendedoresMapa(mapa);
    });
  }, []);

  useEffect(() => {
    cargar();
  }, [fecha]);

  // Advertencia del navegador si hay cambios sin guardar y se intenta salir/recargar la página.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (cambiosSinGuardar.size > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [cambiosSinGuardar]);

  async function cargar() {
    const desde = new Date(fecha + "T00:00:00");
    const hasta = new Date(fecha + "T23:59:59");
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, closed_at, total_cerrado, customers(name, phone), order_items(id, product_id, quantity, unit_price, assigned_at, seller_id, products(code, name, description, category_id, cost))")
      .eq("status", "closed")
      .gte("closed_at", desde.toISOString())
      .lte("closed_at", hasta.toISOString())
      .order("closed_at", { ascending: false });

    const lista: VentaCerrada[] = (data ?? []).map((o: any) => ({
      id: o.id,
      order_number: o.order_number,
      cliente: o.customers?.name ?? "Cliente",
      telefono: o.customers?.phone ?? "",
      closed_at: o.closed_at,
      total_cerrado: o.total_cerrado,
      items: (o.order_items ?? []).map((it: any) => ({
        id: it.id,
        product_id: it.product_id,
        codigo: it.products?.code ?? "",
        nombre: it.products?.name ?? "",
        categoria_id: it.products?.category_id ?? null,
        descripcion: it.products?.description ?? "",
        costo: Number(it.products?.cost ?? 0),
        cantidad: it.quantity,
        precio_base: it.unit_price,
        fecha: new Date(it.assigned_at).toLocaleDateString("es-BO"),
        vendedorNombre: it.seller_id ? (vendedoresMapa[it.seller_id] ?? "Vendedor eliminado") : "Sin vendedor",
      })),
    }));
    setVentas(lista);

    if (lista.length > 0) {
      const ids = lista.map((v) => v.id);
      const { data: devs } = await supabase
        .from("returns")
        .select("*, return_items(*)")
        .in("order_id", ids)
        .order("created_at", { ascending: false });
      const porOrden: Record<string, (Devolucion & { items: DevolucionItem[] })[]> = {};
      (devs ?? []).forEach((d: any) => {
        porOrden[d.order_id] = porOrden[d.order_id] || [];
        porOrden[d.order_id].push({ ...d, items: d.return_items ?? [] });
      });
      setDevoluciones(porOrden);

      const { data: pagosData } = await supabase.from("payments").select("order_id, amount").in("order_id", ids);
      const sumaPagos: Record<string, number> = {};
      (pagosData ?? []).forEach((p: any) => { sumaPagos[p.order_id] = (sumaPagos[p.order_id] ?? 0) + p.amount; });
      setPagos(sumaPagos);
    } else {
      setDevoluciones({});
      setPagos({});
    }
  }

  function totalesVenta(v: VentaCerrada) {
    // "Venta bruta" es el total vigente (total_cerrado): si hubo una corrección,
    // YA está actualizado al valor correcto. Por eso la venta neta solo resta
    // las devoluciones REALES de producto — los reembolsos por corrección NO se
    // vuelven a restar aquí (evita el doble descuento que corregimos en V4).
    const grupos = agruparPorProducto(reglas, v.items);
    const bruta = v.total_cerrado ?? grupos.reduce((a, g) => a + g.subtotalConDescuento, 0);
    const devsActivas = (devoluciones[v.id] ?? []).filter((d) => d.status === "activa");
    const devolucionProducto = devsActivas.filter((d) => d.type === "producto").reduce((a, d) => a + d.total_amount, 0);
    const reembolsoCorreccion = 0;
    const neta = bruta - devolucionProducto;
    const cobrado = pagos[v.id] ?? 0;
    // Cobro neto sí resta ambos: los dos son dinero que salió de la caja.
    const cobroNeto = cobrado - devolucionProducto;
    return { grupos, bruta, devolucionProducto, reembolsoCorreccion, neta, cobrado, cobroNeto };
  }

  const resumenDia = useMemo(() => {
    return ventas.reduce(
      (acc, v) => {
        const t = totalesVenta(v);
        return {
          bruta: acc.bruta + t.bruta,
          devolucionProducto: acc.devolucionProducto + t.devolucionProducto,
          reembolsoCorreccion: acc.reembolsoCorreccion + t.reembolsoCorreccion,
          neta: acc.neta + t.neta,
          unidades: acc.unidades + t.grupos.reduce((a, g) => a + g.cantidadTotal, 0),
        };
      },
      { bruta: 0, devolucionProducto: 0, reembolsoCorreccion: 0, neta: 0, unidades: 0 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventas, reglas, devoluciones, pagos]);

  // La edición es un borrador: + / - y productos nuevos NO tocan inventario ni dinero hasta Guardar cambios.
  function ajustarVentaDirecta(orderId: string, productId: string, delta: number, codigo="", nombre="") {
    const venta=ventas.find(v=>v.id===orderId); const actual=venta?.items.filter(i=>i.product_id===productId).reduce((a,i)=>a+i.cantidad,0)??0;
    const previo=cambiosPendientes[orderId]?.[productId]?.delta??0;
    if(actual+previo+delta<0) return;
    setCambiosPendientes(prev=>({...prev,[orderId]:{...(prev[orderId]??{}),[productId]:{delta:previo+delta,codigo,nombre}}}));
    setCambiosSinGuardar(prev=>new Set(prev).add(orderId));
  }

  async function agregarItem(orderId: string) {
    if (!codigoNuevo.trim()) return;
    const { data: producto } = await supabase.from("products").select("id,code,name,stock_available").eq("code", codigoNuevo.trim()).is("deleted_at", null).maybeSingle();
    if (!producto) { alert("No se encontró ese código en el inventario."); return; }
    const previo=cambiosPendientes[orderId]?.[producto.id]?.delta??0;
    if(Number(producto.stock_available??0)<previo+cantidadNueva){alert(`Stock insuficiente. Disponible: ${producto.stock_available}`);return;}
    ajustarVentaDirecta(orderId, producto.id, cantidadNueva, producto.code, producto.name);
    setCodigoNuevo(""); setCantidadNueva(1);
  }

  async function guardarCambios(orderId: string) {
    const cambios=Object.entries(cambiosPendientes[orderId]??{}).filter(([,x])=>x.delta!==0).map(([product_id,x])=>({product_id,delta:x.delta}));
    if(!cambios.length){setEditando(null);return;}
    const {error}=await supabase.rpc("save_closed_sale_corrections",{p_order_id:orderId,p_changes:cambios});
    if(error){alert(`No se pudieron guardar los cambios: ${error.message}`);return;}
    setCambiosPendientes(prev=>{const n={...prev};delete n[orderId];return n});
    setCambiosSinGuardar(prev=>{const n=new Set(prev);n.delete(orderId);return n});
    setEditando(null); await cargar();
  }

  function cancelarCambios(orderId:string){
    setCambiosPendientes(prev=>{const n={...prev};delete n[orderId];return n});
    setCambiosSinGuardar(prev=>{const n=new Set(prev);n.delete(orderId);return n}); setEditando(null);
  }

  function abrirDevolucion(v: VentaCerrada) {
    setMostrarDevolucion(v.id);
    setDevItemId(v.items[0]?.id ?? "");
    setDevCantidad(1);
    setDevMonto(0);
    setDevMotivo(MOTIVOS[0]);
    setDevRestock("");
    setDevObs("");
  }

  async function confirmarDevolucion(v: VentaCerrada) {
    if (!devItemId || devMonto <= 0 || devRestock === "") {
      alert("Completa producto, monto, y si el producto vuelve o no al inventario.");
      return;
    }
    const { data: returnId, error } = await supabase.rpc("registrar_devolucion_producto", {
      p_order_item_id: devItemId,
      p_quantity: devCantidad,
      p_amount: devMonto,
      p_reason: devMotivo,
      p_restock: devRestock === "si",
      p_observation: devObs || null,
    });
    if (error) { alert(error.message); return; }

    const item = v.items.find((it) => it.id === devItemId);
    generarPdfDevolucion({
      negocio: "Loves Stories",
      cliente: v.cliente,
      numeroVenta: v.order_number,
      fecha: new Date().toLocaleDateString("es-BO"),
      producto: item ? `${item.codigo} · ${item.nombre}` : "",
      cantidad: devCantidad,
      motivo: devMotivo,
      monto: devMonto,
      formaDevolucion: devRestock === "si" ? "Producto vuelve al inventario" : "Producto dado de baja (no vendible)",
      observacion: devObs || undefined,
    });

    setMostrarDevolucion(null);
    cargar();
  }

  async function anularDevolucion(id: string) {
    const motivo = prompt("Motivo de la anulación:");
    if (!motivo) return;
    const { error } = await supabase.rpc("anular_devolucion", { p_return_id: id, p_motivo: motivo });
    if (error) { alert(error.message); return; }
    cargar();
  }

  function regenerarPdf(v: VentaCerrada) {
    const t = totalesVenta(v);
    generarPdfGrande({
      negocio: "Loves Stories",
      cliente: v.cliente,
      telefono: v.telefono,
      fecha: new Date(v.closed_at).toLocaleDateString("es-BO"),
      titulo: "Cuenta cerrada",
      grupos: t.grupos,
      subtotalSinDescuento: t.grupos.reduce((a, g) => a + g.subtotalSinDescuento, 0),
      descuentoTotal: t.grupos.reduce((a, g) => a + g.descuento, 0),
      total: t.bruta,
      depositado: t.cobrado,
      saldoPendiente: 0,
      saldoAFavor: Math.max(0, t.cobrado - t.bruta),
      mostrarPagos: true,
    });
  }

  function imprimirRecibo(v: VentaCerrada) {
    setReciboVenta(v.id);
  }

  async function exportarVentasExcel() {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Loves Stories";
    wb.created = new Date();

    const detalle = wb.addWorksheet("Detalle de ventas", { views: [{ state: "frozen", ySplit: 5 }] });
    const clientes = wb.addWorksheet("Ventas por cliente", { views: [{ state: "frozen", ySplit: 4 }] });

    const oro = "B58A3B";
    const vino = "4A2637";
    const crema = "F7F3EC";
    const verde = "4F6F52";
    const blanco = "FFFFFF";
    const borde = "D9D0C2";

    const filasDetalle: any[] = [];
    ventas.forEach(v => {
      const grupos = agruparPorProducto(reglas, v.items);
      grupos.forEach(g => {
        const original = v.items.find(i => i.product_id === g.product_id) as any;
        const costoUnitario = Number(original?.costo ?? 0);
        const precioUnitario = Number(g.precioUnitarioFinal ?? 0);
        const cantidad = Number(g.cantidadTotal ?? 0);
        const ventaTotal = precioUnitario * cantidad;
        const costoTotal = costoUnitario * cantidad;
        const ganancia = ventaTotal - costoTotal;
        filasDetalle.push({
          fecha: new Date(v.closed_at), cliente: v.cliente, telefono: v.telefono,
          codigo: g.codigo, producto: g.nombre, cantidad,
          costoUnitario, precioUnitario, ventaTotal, costoTotal, ganancia,
          margenPct: ventaTotal > 0 ? ganancia / ventaTotal : 0,
          orderId: v.id,
        });
      });
    });

    const ventaTotalGeneral = filasDetalle.reduce((a,r)=>a+r.ventaTotal,0);
    const costoTotalGeneral = filasDetalle.reduce((a,r)=>a+r.costoTotal,0);
    const gananciaGeneral = ventaTotalGeneral - costoTotalGeneral;
    const ventasUnicas = new Set(filasDetalle.map(r=>r.orderId)).size;
    const unidades = filasDetalle.reduce((a,r)=>a+r.cantidad,0);
    const margenGeneral = ventaTotalGeneral > 0 ? gananciaGeneral / ventaTotalGeneral : 0;
    const promedioVenta = ventasUnicas > 0 ? ventaTotalGeneral / ventasUnicas : 0;

    detalle.mergeCells("A1:L1");
    detalle.getCell("A1").value = "REPORTE DE VENTAS — LOVES STORIES";
    detalle.getCell("A1").font = { bold:true, size:18, color:{argb:blanco} };
    detalle.getCell("A1").alignment = { horizontal:"center", vertical:"middle" };
    detalle.getCell("A1").fill = { type:"pattern", pattern:"solid", fgColor:{argb:vino} };
    detalle.getRow(1).height = 30;
    detalle.mergeCells("A2:L2");
    detalle.getCell("A2").value = `Fecha del reporte: ${new Date(fecha + "T12:00:00").toLocaleDateString("es-BO")}`;
    detalle.getCell("A2").alignment = { horizontal:"center" };
    detalle.getCell("A2").font = { italic:true, color:{argb:"5B4E5E"} };

    const resumen = [
      ["Ventas totales", ventaTotalGeneral], ["Costo total", costoTotalGeneral], ["Ganancia total", gananciaGeneral],
      ["Margen", margenGeneral], ["Nº de ventas", ventasUnicas], ["Unidades", unidades], ["Venta promedio", promedioVenta]
    ];
    resumen.forEach((r,i)=>{
      const c = 1 + i;
      detalle.getCell(3,c).value = r[0]; detalle.getCell(4,c).value = r[1] as any;
      detalle.getCell(3,c).font = {bold:true,color:{argb:blanco}};
      detalle.getCell(3,c).fill = {type:"pattern",pattern:"solid",fgColor:{argb:oro}};
      detalle.getCell(3,c).alignment = {horizontal:"center"};
      detalle.getCell(4,c).alignment = {horizontal:"center"};
      detalle.getCell(4,c).fill = {type:"pattern",pattern:"solid",fgColor:{argb:crema}};
    });
    [1,2,3,7].forEach(c=>detalle.getCell(4,c).numFmt='"Bs" #,##0.00');
    detalle.getCell(4,4).numFmt='0.00%';

    const headers = ["Fecha","Cliente","Teléfono","Código","Producto","Cantidad","Costo unitario","Precio de venta","Venta total","Costo total","Ganancia","Margen %"];
    const widths = [20,26,17,14,28,11,16,17,16,16,16,13];
    headers.forEach((h,i)=>{ const cell=detalle.getCell(5,i+1); cell.value=h; cell.font={bold:true,color:{argb:blanco}}; cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:vino}}; cell.alignment={horizontal:"center"}; cell.border={bottom:{style:"thin",color:{argb:borde}}}; detalle.getColumn(i+1).width=widths[i]; });
    filasDetalle.forEach((r,idx)=>{
      const row=detalle.addRow([r.fecha,r.cliente,r.telefono,r.codigo,r.producto,r.cantidad,r.costoUnitario,r.precioUnitario,r.ventaTotal,r.costoTotal,r.ganancia,r.margenPct]);
      row.getCell(1).numFmt="dd/mm/yyyy hh:mm";
      [7,8,9,10,11].forEach(c=>row.getCell(c).numFmt='"Bs" #,##0.00');
      row.getCell(12).numFmt="0.00%";
      if(idx%2===1) row.eachCell(c=>c.fill={type:"pattern",pattern:"solid",fgColor:{argb:crema}});
    });
    detalle.autoFilter={from:"A5",to:"L5"};

    const porCliente = new Map<string, any>();
    filasDetalle.forEach(r=>{
      const key=`${r.cliente}__${r.telefono}`;
      const x=porCliente.get(key) ?? {cliente:r.cliente,telefono:r.telefono,orders:new Set<string>(),unidades:0,ventas:0,costos:0,ganancia:0};
      x.orders.add(r.orderId); x.unidades+=r.cantidad; x.ventas+=r.ventaTotal; x.costos+=r.costoTotal; x.ganancia+=r.ganancia;
      porCliente.set(key,x);
    });
    const listaClientes=Array.from(porCliente.values()).sort((a,b)=>b.ventas-a.ventas);

    clientes.mergeCells("A1:H1"); clientes.getCell("A1").value="REPORTE DE VENTAS POR CLIENTE";
    clientes.getCell("A1").font={bold:true,size:18,color:{argb:blanco}}; clientes.getCell("A1").fill={type:"pattern",pattern:"solid",fgColor:{argb:vino}}; clientes.getCell("A1").alignment={horizontal:"center"}; clientes.getRow(1).height=30;
    clientes.mergeCells("A2:H2"); clientes.getCell("A2").value=`Fecha del reporte: ${new Date(fecha + "T12:00:00").toLocaleDateString("es-BO")}`; clientes.getCell("A2").alignment={horizontal:"center"};
    const h2=["Cliente","Teléfono","Número de ventas","Unidades compradas","Acumulado ventas","Costo acumulado","Ganancia acumulada","Margen %"];
    const w2=[28,18,18,19,20,20,21,13];
    h2.forEach((h,i)=>{const c=clientes.getCell(4,i+1);c.value=h;c.font={bold:true,color:{argb:blanco}};c.fill={type:"pattern",pattern:"solid",fgColor:{argb:verde}};c.alignment={horizontal:"center"};clientes.getColumn(i+1).width=w2[i];});
    listaClientes.forEach((x,idx)=>{
      const margen=x.ventas>0?x.ganancia/x.ventas:0;
      const row=clientes.addRow([x.cliente,x.telefono,x.orders.size,x.unidades,x.ventas,x.costos,x.ganancia,margen]);
      [5,6,7].forEach(c=>row.getCell(c).numFmt='"Bs" #,##0.00'); row.getCell(8).numFmt="0.00%";
      if(idx%2===1) row.eachCell(c=>c.fill={type:"pattern",pattern:"solid",fgColor:{argb:crema}});
    });
    clientes.autoFilter={from:"A4",to:"H4"};

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`Reporte-Ventas-Loves-Stories-${fecha}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Ventas</p>
        <div className="flex items-center gap-2"><button onClick={exportarVentasExcel} className="text-xs px-3 py-2 rounded-md flex items-center gap-1" style={{background:"#EDE7DE",border:"1px solid #D9D0C2"}}><FileDown size={13}/> Exportar Excel</button><div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <Calendar size={14} style={{ color: "#5B4E5E" }} />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="text-sm outline-none bg-transparent" />
        </div></div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Venta bruta</p>
          <p className="font-serif text-lg">Bs {resumenDia.bruta.toFixed(2)}</p>
        </div>
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Devolución de producto</p>
          <p className="font-serif text-lg" style={{ color: "#7A2540" }}>Bs {resumenDia.devolucionProducto.toFixed(2)}</p>
        </div>
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Venta neta</p>
          <p className="font-serif text-lg" style={{ color: "#4F6F52" }}>Bs {resumenDia.neta.toFixed(2)}</p>
        </div>
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Unidades vendidas</p>
          <p className="font-serif text-lg">{resumenDia.unidades}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {ventas.map((v) => {
          const t = totalesVenta(v);
          const abierto = editando === v.id;
          const devs = (devoluciones[v.id] ?? []).filter(d=>d.type === "producto");
          return (
            <div key={v.id} className="p-4 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-medium">Pedido #{v.order_number} · {v.cliente}</p>
                  <p className="text-xs" style={{ color: "#5B4E5E" }}>{v.telefono} · cerrado {new Date(v.closed_at).toLocaleString("es-BO")}</p>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => regenerarPdf(v)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                    <FileDown size={12} /> PDF
                  </button>
                  <button onClick={() => imprimirRecibo(v)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} title="Recibo térmico 80×80mm, sin fotos">
                    <Printer size={12} /> Imprimir
                  </button>
                  <button onClick={() => abrirDevolucion(v)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#F4E3E6", color: "#7A2540" }}>
                    <Undo2 size={12} /> Registrar devolución
                  </button>
                  <button onClick={() => {
                    if (abierto && cambiosSinGuardar.has(v.id)) {
                      const salir = confirm("Tienes cambios sin guardar en esta venta. Si sales ahora, el total oficial NO se actualizará. ¿Salir de todas formas?");
                      if (!salir) return;
                    }
                    setEditando(abierto ? null : v.id);
                  }} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                    <Pencil size={12} /> {abierto ? "Cerrar edición" : "Editar (corregir)"}
                  </button>
                </div>
              </div>

              <div style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} className="rounded mb-2">
                {t.grupos.map((g, i) => (
                  <div key={g.product_id} className="px-3 py-2" style={{ borderBottom: i < t.grupos.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{g.codigo} · {g.nombre} × {g.cantidadTotal}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-serif">Bs {g.subtotalConDescuento.toFixed(2)}</span>
                        {abierto && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => ajustarVentaDirecta(v.id, g.product_id, -1, g.codigo, g.nombre)} title="Disminuir 1; devuelve stock y dinero" className="p-1 rounded" style={{ color: "#7A2540", border: "1px solid #D9D0C2" }}><Minus size={13} /></button>
                            <span className="text-xs min-w-5 text-center">{g.cantidadTotal + (cambiosPendientes[v.id]?.[g.product_id]?.delta ?? 0)}</span>
                            <button onClick={() => ajustarVentaDirecta(v.id, g.product_id, 1, g.codigo, g.nombre)} title="Aumentar 1; descuenta stock y registra cobro" className="p-1 rounded" style={{ color: "#4F6F52", border: "1px solid #D9D0C2" }}><Plus size={13} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-xs" style={{ color: "#5B4E5E" }}>{g.detalle.map((d) => `${d.cantidad} un. — ${d.fecha}${d.vendedorNombre ? ` (${d.vendedorNombre})` : ""}`).join(" · ")}</p>
                  </div>
                ))}
              </div>

              {abierto && <div className="p-3 mb-2 rounded" style={{background:"#EDE7DE",border:"1px solid #D9D0C2"}}>
                <p className="text-xs mb-2" style={{color:"#5B4E5E"}}>Usa − / + o agrega otro producto. Nada se modifica hasta pulsar <strong>Guardar cambios</strong>.</p>
                <div className="flex flex-wrap gap-2 items-end"><div><p className="text-xs mb-1">Código de otro producto</p><input value={codigoNuevo} onChange={e=>setCodigoNuevo(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();agregarItem(v.id)}}} className="px-2 py-1.5 rounded text-sm" placeholder="Código"/></div><div><p className="text-xs mb-1">Cantidad</p><input type="number" min={1} value={cantidadNueva} onChange={e=>setCantidadNueva(Math.max(1,Number(e.target.value)))} className="w-20 px-2 py-1.5 rounded text-sm"/></div><button onClick={()=>agregarItem(v.id)} className="text-xs px-3 py-2 rounded" style={{background:"#4F6F52",color:"white"}}><Plus size={12} className="inline"/> Agregar</button><button onClick={()=>guardarCambios(v.id)} className="text-xs px-3 py-2 rounded flex items-center gap-1" style={{background:"#9C7A3C",color:"white"}}><Save size={12}/> Guardar cambios</button><button onClick={()=>cancelarCambios(v.id)} className="text-xs px-3 py-2 rounded" style={{background:"#F7F3EC",border:"1px solid #D9D0C2"}}>Cancelar</button></div>
                {Object.entries(cambiosPendientes[v.id]??{}).filter(([,x])=>x.delta>0 && !t.grupos.some(g=>g.product_id===pid)).map(([pid,x])=><p key={pid} className="text-xs mt-2" style={{color:"#4F6F52"}}>+ {x.delta} × {x.codigo} · {x.nombre}</p>)}
              </div>}

              {mostrarDevolucion === v.id && (
                <div className="p-3 mb-2 rounded-md" style={{ background: "#F4E3E6", border: "1px solid #7A2540" }}>
                  <p className="text-xs font-medium mb-2" style={{ color: "#7A2540" }}>Registrar devolución</p>
                  <div className="grid sm:grid-cols-2 gap-2 mb-2">
                    <select value={devItemId} onChange={(e) => setDevItemId(e.target.value)} className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                      {v.items.map((it) => <option key={it.id} value={it.id}>{it.codigo} · {it.nombre} ({it.cantidad} vendidas)</option>)}
                    </select>
                    <select value={devMotivo} onChange={(e) => setDevMotivo(e.target.value)} className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                      {MOTIVOS.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2 mb-2">
                    <div>
                      <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Cantidad</p>
                      <input type="number" min={1} value={devCantidad} onChange={(e) => setDevCantidad(Math.max(1, Number(e.target.value)))} className="w-full px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Monto a devolver (Bs)</p>
                      <input type="number" min={0} value={devMonto} onChange={(e) => setDevMonto(Number(e.target.value))} className="w-full px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>¿El producto vuelve al inventario?</p>
                      <select value={devRestock} onChange={(e) => setDevRestock(e.target.value as any)} className="w-full px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                        <option value="">Elige una opción...</option>
                        <option value="si">Sí, está en buen estado</option>
                        <option value="no">No, está dañado / no vendible</option>
                      </select>
                    </div>
                  </div>
                  <input value={devObs} onChange={(e) => setDevObs(e.target.value)} placeholder="Observación (opcional)"
                    className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  <div className="flex gap-2">
                    <button onClick={() => confirmarDevolucion(v)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#7A2540", color: "#F7F3EC" }}>Confirmar devolución</button>
                    <button onClick={() => setMostrarDevolucion(null)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>Cancelar</button>
                  </div>
                </div>
              )}

              {devs.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Devoluciones de esta venta</p>
                  {devs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between px-3 py-1.5 rounded mb-1" style={{ background: d.status === "anulada" ? "#EDE7DE" : "#F4E3E6" }}>
                      <span className="text-xs" style={{ color: d.status === "anulada" ? "#5B4E5E" : "#7A2540", textDecoration: d.status === "anulada" ? "line-through" : "none" }}>
                        {d.type === "correccion" ? "Ajuste por corrección" : (d.items[0]?.reason ?? "Devolución")} — Bs {d.total_amount.toFixed(2)}
                        {d.status === "anulada" && ` (anulada: ${d.cancel_reason})`}
                      </span>
                      {d.status === "activa" && (
                        <button onClick={() => anularDevolucion(d.id)} className="text-xs px-2 py-1 rounded flex items-center gap-1" style={{ color: "#7A2540" }}>
                          <RotateCcw size={11} /> Anular
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-2" style={{ borderTop: "1px solid #D9D0C2" }}>
                <span style={{ color: "#5B4E5E" }}>Bruta: Bs {t.bruta.toFixed(2)}</span>
                <span style={{ color: "#7A2540" }}>Dev. producto: Bs {t.devolucionProducto.toFixed(2)}</span>
                <span style={{ color: "#4F6F52" }}>Neta: Bs {t.neta.toFixed(2)}</span>
                <span className="font-serif">Cobro neto: Bs {t.cobroNeto.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
        {ventas.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>No hay ventas cerradas en esta fecha.</p>}
      </div>

      {reciboVenta && (() => {
        const v = ventas.find((x) => x.id === reciboVenta);
        if (!v) return null;
        const t = totalesVenta(v);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(43,30,46,0.85)" }}>
            <div className="flex flex-col items-center">
              <div id="recibo-termico" style={{ background: "#fff", color: "#111", width: 302, fontFamily: "monospace" }} className="p-2 text-xs shadow-md">
                <p className="text-center font-bold" style={{ fontSize: "1rem" }}>Loves Stories</p>
                <p className="text-center">Recibo — Pedido #{v.order_number}</p>
                <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                <p>Cliente: {v.cliente}</p>
                {t.grupos.map((g) => (
                  <div key={g.product_id} className="flex justify-between"><span>{g.codigo} x{g.cantidadTotal}</span><span>Bs {g.subtotalConDescuento.toFixed(2)}</span></div>
                ))}
                <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                <div className="flex justify-between font-bold"><span>Total</span><span>Bs {t.bruta.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Cobrado</span><span>Bs {t.cobrado.toFixed(2)}</span></div>
                {t.devolucionProducto > 0 && (
                  <div className="flex justify-between"><span>Devuelto</span><span>Bs {t.devolucionProducto.toFixed(2)}</span></div>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => window.print()} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                  <Printer size={13} /> Imprimir (térmica 80×80mm)
                </button>
                <button onClick={() => setReciboVenta(null)} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                  <X size={13} /> Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
