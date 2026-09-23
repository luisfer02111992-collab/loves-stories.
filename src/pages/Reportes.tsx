import React, { useEffect, useState } from "react";
import { Boxes, PackageX } from "lucide-react";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import StatCard from "../components/StatCard";
import type { Product } from "../lib/types";

function desde(periodo: string) {
  const d = new Date();
  if (periodo === "dia") d.setHours(0, 0, 0, 0);
  if (periodo === "mes") d.setDate(1);
  if (periodo === "anio") { d.setMonth(0); d.setDate(1); }
  return d.toISOString();
}

export default function Reportes() {
  const [periodo, setPeriodo] = useState("dia");
  const [ventas, setVentas] = useState(0);
  const [devolucionProducto, setDevolucionProducto] = useState(0);
  const [cobrado, setCobrado] = useState(0);
  const [costo, setCosto] = useState(0);
  const [costoBuenEstado, setCostoBuenEstado] = useState(0);
  const [costoMerma, setCostoMerma] = useState(0);
  const [unidades, setUnidades] = useState(0);
  const [porCategoria, setPorCategoria] = useState<{ cat: string; ventas: number }[]>([]);
  const [productos, setProductos] = useState<Product[]>([]);
  const [estiloGrafico, setEstiloGrafico] = useState("bar");
  const [stockMuerto, setStockMuerto] = useState<{ code: string; name: string; stock_available: number; ultima: string | null }[]>([]);

  useEffect(() => {
    cargarPeriodo();
  }, [periodo]);

  useEffect(() => {
    supabase.from("products").select("*").is("deleted_at", null).then(({ data }) => setProductos((data as Product[]) ?? []));
    cargarStockMuerto();
    const local = localStorage.getItem("loves_chart_style"); if (local) setEstiloGrafico(local);
    supabase.from("app_settings").select("chart_style").eq("id",1).single().then(({data})=>{ const e=data?.chart_style ?? local ?? "bar"; setEstiloGrafico(e); localStorage.setItem("loves_chart_style",e); });
    const sync=()=>setEstiloGrafico(localStorage.getItem("loves_chart_style") ?? "bar"); window.addEventListener("loves-chart-style-changed",sync); return ()=>window.removeEventListener("loves-chart-style-changed",sync);
  }, []);

  async function cargarPeriodo() {
    const inicio = desde(periodo);
    const { data } = await supabase
      .from("orders")
      .select("id, closed_at, total_cerrado, order_items(quantity, unit_price, products(cost, categories(name)))")
      .eq("status", "closed")
      .gte("closed_at", inicio);

    let bruta = 0, c = 0, u = 0;
    const cat: Record<string, number> = {};
    const idsOrdenes: string[] = [];
    (data ?? []).forEach((o: any) => {
      bruta += o.total_cerrado ?? 0;
      idsOrdenes.push(o.id);
      (o.order_items ?? []).forEach((it: any) => {
        c += it.quantity * (it.products?.cost ?? 0);
        u += it.quantity;
        const nombreCat = it.products?.categories?.name ?? "Otros";
        cat[nombreCat] = (cat[nombreCat] ?? 0) + it.quantity * it.unit_price;
      });
    });

    let devolucionProducto = 0;
    let costoBuenEstado = 0, costoMerma = 0;
    if (idsOrdenes.length > 0) {
      const { data: devs } = await supabase.from("returns").select("total_amount, type, order_id").eq("status", "activa").in("order_id", idsOrdenes);
      (devs ?? []).forEach((d: any) => {
        if (d.type === "producto") devolucionProducto += d.total_amount;
      });

      // Costo de las unidades devueltas: si volvieron al inventario (restock),
      // ese costo se resta de "mercadería vendida" (ya no se considera vendido,
      // volvió al stock). Si NO volvieron (dañadas), el costo se mantiene como
      // vendido pero se muestra aparte como pérdida/merma — sin restarlo dos veces.
      const { data: retItems } = await supabase
        .from("return_items")
        .select("quantity, restock, products(cost), returns!inner(order_id, status, type)")
        .eq("returns.status", "activa")
        .eq("returns.type", "producto")
        .in("returns.order_id", idsOrdenes);
      (retItems ?? []).forEach((ri: any) => {
        const costoUnidad = (ri.quantity ?? 0) * (ri.products?.cost ?? 0);
        if (ri.restock) costoBuenEstado += costoUnidad;
        else costoMerma += costoUnidad;
      });
    }

    let cobrado = 0;
    if (idsOrdenes.length > 0) {
      const { data: pagosData } = await supabase.from("payments").select("amount, order_id").in("order_id", idsOrdenes);
      cobrado = (pagosData ?? []).reduce((a: number, p: any) => a + p.amount, 0);
    }

    setVentas(bruta);
    setDevolucionProducto(devolucionProducto);
    setCobrado(cobrado);
    setCosto(c);
    setCostoBuenEstado(costoBuenEstado);
    setCostoMerma(costoMerma);
    setUnidades(u);
    setPorCategoria(Object.entries(cat).map(([cat, ventas]) => ({ cat, ventas })));
  }

  async function cargarStockMuerto() {
    const limite = new Date();
    limite.setDate(limite.getDate() - 45);
    const { data } = await supabase.from("products").select("code, name, stock_available, updated_at").is("deleted_at", null).lt("updated_at", limite.toISOString()).gt("stock_available", 0).limit(6);
    setStockMuerto((data ?? []).map((p: any) => ({ ...p, ultima: p.updated_at })));
  }

  // Venta neta solo resta devoluciones REALES de producto. El reembolso por
  // corrección no se vuelve a restar aquí: "ventas" (bruta) ya viene de
  // total_cerrado, que quedó en el valor correcto tras cualquier corrección.
  const ventaNeta = ventas - devolucionProducto;
  const devueltoTotal = devolucionProducto;
  const cobroNeto = cobrado - devueltoTotal;
  // Costo de mercadería vendida ajustado: al producto devuelto en buen estado
  // se le resta su costo (volvió al inventario, ya no se considera vendido).
  // El costo de un producto devuelto dañado/no vendible se queda contado aquí
  // (de verdad se perdió) y se muestra aparte, sin restarlo dos veces.
  const costoVendidoAjustado = costo - costoBuenEstado;
  const ganancia = ventaNeta - costoVendidoAjustado;
  const valorCosto = productos.reduce((a, p) => a + p.cost * p.stock_available, 0);
  const valorVenta = productos.reduce((a, p) => a + p.price * p.stock_available, 0);
  const gananciaPotencial = valorVenta - valorCosto;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Reportes</p>
        <div className="flex gap-1">
          {[{ key: "dia", label: "Día" }, { key: "mes", label: "Mes" }, { key: "anio", label: "Año" }].map((o) => (
            <button key={o.key} onClick={() => setPeriodo(o.key)} className="text-xs px-3 py-1.5 rounded-md"
              style={{ background: periodo === o.key ? "#9C7A3C" : "#F7F3EC", color: periodo === o.key ? "#F7F3EC" : "#5B4E5E", border: "1px solid #D9D0C2" }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <StatCard label="Venta bruta" value={`Bs ${ventas.toLocaleString("es-BO")}`} />
        <StatCard label="Devolución de producto" value={`Bs ${devolucionProducto.toLocaleString("es-BO")}`} accent="#7A2540" />
        <StatCard label="Venta neta" value={`Bs ${ventaNeta.toLocaleString("es-BO")}`} accent="#4F6F52" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Cobrado" value={`Bs ${cobrado.toLocaleString("es-BO")}`} />
        <StatCard label="Dinero devuelto" value={`Bs ${devueltoTotal.toLocaleString("es-BO")}`} accent="#7A2540" />
        <StatCard label="Cobro neto" value={`Bs ${cobroNeto.toLocaleString("es-BO")}`} accent="#4F6F52" />
        <StatCard label="Unidades vendidas" value={unidades} />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Costo de mercadería vendida" value={`Bs ${costoVendidoAjustado.toLocaleString("es-BO")}`} />
        <StatCard label="Pérdida por merma (devoluciones)" value={`Bs ${costoMerma.toLocaleString("es-BO")}`} accent="#7A2540" />
        <StatCard label="Ganancia neta" value={`Bs ${ganancia.toLocaleString("es-BO")}`} accent="#4F6F52" />
      </div>

      <div className="p-4 mb-4" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="font-serif text-base mb-1 flex items-center gap-2"><Boxes size={16} style={{ color: "#5B4E5E" }} /> Valor del inventario actual</p>
        <div className="grid grid-cols-3 gap-3 mt-2">
          <StatCard label="A costo" value={`Bs ${valorCosto.toLocaleString("es-BO")}`} />
          <StatCard label="A precio de venta" value={`Bs ${valorVenta.toLocaleString("es-BO")}`} accent="#9C7A3C" />
          <StatCard label="Ganancia potencial" value={`Bs ${gananciaPotencial.toLocaleString("es-BO")}`} accent="#4F6F52" />
        </div>
      </div>

      <div className="p-4 mb-4" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="font-serif text-base mb-3">Ventas por categoría</p>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            {estiloGrafico === "line" ? <LineChart data={porCategoria}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="cat"/><YAxis/><Tooltip/><Line type="monotone" dataKey="ventas" /></LineChart> : estiloGrafico === "area" ? <AreaChart data={porCategoria}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="cat"/><YAxis/><Tooltip/><Area type="monotone" dataKey="ventas" /></AreaChart> : <BarChart data={porCategoria}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="cat"/><YAxis/><Tooltip/><Bar dataKey="ventas" /></BarChart>}
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-4" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="font-serif text-base mb-1 flex items-center gap-2"><PackageX size={16} style={{ color: "#5B4E5E" }} /> Productos sin movimiento</p>
        {stockMuerto.map((p, i) => (
          <div key={p.code} className="flex justify-between text-sm py-1.5" style={{ borderBottom: i < stockMuerto.length - 1 ? "1px solid #D9D0C2" : "none" }}>
            <span>{p.code} · {p.name}</span>
            <span style={{ color: "#5B4E5E" }}>{p.stock_available} unid.</span>
          </div>
        ))}
        {stockMuerto.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>No hay productos estancados por ahora.</p>}
      </div>
    </div>
  );
}
