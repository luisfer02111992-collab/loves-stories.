import React, { useEffect, useState } from "react";
import { Calendar, BadgePercent, FileDown } from "lucide-react";
import { supabase } from "../lib/supabase";
import { loadPricingRules, agruparPorProducto, PricingRule, LineaPedido } from "../lib/pricing";
import { generarPdfSesion } from "../lib/pdf";
import type { Seller, SalesSession } from "../lib/types";

interface FilaVendedor {
  sellerId: string | null;
  nombre: string;
  unidadesAsignadas: number;
  unidadesNetas: number;
  ventaBruta: number;
  devoluciones: number;
  ventaNeta: number;
  comision: number;
  comisionTexto: string;
}

export default function ReporteVendedores() {
  const [desde, setDesde] = useState(() => new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().slice(0, 10));
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [vendedores, setVendedores] = useState<Seller[]>([]);
  const [filas, setFilas] = useState<FilaVendedor[]>([]);
  const [sesiones, setSesiones] = useState<SalesSession[]>([]);
  const [generandoSesion, setGenerandoSesion] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    supabase.from("sellers").select("*").order("name").then(({ data }) => setVendedores((data as Seller[]) ?? []));
  }, []);

  useEffect(() => {
    calcular();
    cargarSesiones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, vendedores]);

  async function cargarSesiones() {
    const desdeIso = new Date(desde + "T00:00:00").toISOString();
    const hastaIso = new Date(hasta + "T23:59:59").toISOString();
    const { data } = await supabase.from("sales_sessions").select("*").gte("started_at", desdeIso).lte("started_at", hastaIso).order("started_at", { ascending: false });
    setSesiones((data as SalesSession[]) ?? []);
  }

  async function generarPdfDeSesion(sesion: SalesSession) {
    setGenerandoSesion(sesion.id);
    const reglas: PricingRule[] = await loadPricingRules();
    const vendedor = vendedores.find((v) => v.id === sesion.seller_id);

    const { data: itemsSesion } = await supabase
      .from("order_items")
      .select("id, order_id, product_id, quantity, unit_price, assigned_at, products(code, name, category_id)")
      .eq("session_id", sesion.id);
    const filasSesion = itemsSesion ?? [];
    const ordenIds = Array.from(new Set(filasSesion.map((f: any) => f.order_id)));

    const mapaEstado: Record<string, string> = {};
    const itemsPorOrden: Record<string, any[]> = {};
    if (ordenIds.length > 0) {
      const { data: ordenes } = await supabase.from("orders").select("id, status").in("id", ordenIds);
      (ordenes ?? []).forEach((o: any) => (mapaEstado[o.id] = o.status));
      const { data: todosItems } = await supabase
        .from("order_items")
        .select("id, order_id, product_id, quantity, unit_price, assigned_at, products(code, name, category_id)")
        .in("order_id", ordenIds);
      (todosItems ?? []).forEach((it: any) => {
        itemsPorOrden[it.order_id] = itemsPorOrden[it.order_id] || [];
        itemsPorOrden[it.order_id].push(it);
      });
    }

    const { data: devs } = ordenIds.length > 0
      ? await supabase.from("return_items").select("order_item_id, amount, quantity, returns!inner(status, type, order_id)").eq("returns.status", "activa").eq("returns.type", "producto").in("returns.order_id", ordenIds)
      : { data: [] as any[] };
    const devueltoPorItem: Record<string, { amount: number; quantity: number }> = {};
    (devs ?? []).forEach((d: any) => {
      const actual = devueltoPorItem[d.order_item_id] ?? { amount: 0, quantity: 0 };
      devueltoPorItem[d.order_item_id] = { amount: actual.amount + d.amount, quantity: actual.quantity + d.quantity };
    });

    const lineasPorProducto: Record<string, { codigo: string; nombre: string; cantidad: number; precio: number; descuento: number; subtotal: number }> = {};
    let totalVendido = 0, devoluciones = 0, unidadesNetas = 0;

    for (const row of filasSesion) {
      if (mapaEstado[row.order_id] !== "closed") continue;
      const itemsDeEsaOrden: LineaPedido[] = (itemsPorOrden[row.order_id] ?? []).map((it: any) => ({
        id: it.id, product_id: it.product_id, codigo: it.products?.code ?? "", nombre: it.products?.name ?? "",
        categoria_id: it.products?.category_id ?? null, cantidad: it.quantity, precio_base: it.unit_price, fecha: it.assigned_at,
      }));
      const grupos = agruparPorProducto(reglas, itemsDeEsaOrden);
      const grupo = grupos.find((g) => g.product_id === row.product_id);
      const precioFinal = grupo?.precioUnitarioFinal ?? row.unit_price;
      const dev = devueltoPorItem[row.id] ?? { amount: 0, quantity: 0 };
      const subtotal = precioFinal * row.quantity;

      const key = row.product_id;
      if (!lineasPorProducto[key]) {
        lineasPorProducto[key] = { codigo: row.products?.code ?? "", nombre: row.products?.name ?? "", cantidad: 0, precio: precioFinal, descuento: 0, subtotal: 0 };
      }
      lineasPorProducto[key].cantidad += row.quantity;
      lineasPorProducto[key].subtotal += subtotal;
      lineasPorProducto[key].descuento += (row.unit_price - precioFinal) * row.quantity;

      totalVendido += subtotal;
      devoluciones += dev.amount;
      unidadesNetas += row.quantity - dev.quantity;
    }

    const ventaNeta = totalVendido - devoluciones;
    let comisionTexto = "Comisión no configurada", comision = 0;
    if (vendedor?.commission_type === "percentage") {
      comision = ventaNeta * (vendedor.commission_value / 100);
      comisionTexto = `${vendedor.commission_value}% sobre venta neta`;
    } else if (vendedor?.commission_type === "fixed") {
      comision = unidadesNetas * vendedor.commission_value;
      comisionTexto = `Bs ${vendedor.commission_value} × unidad neta`;
    }

    generarPdfSesion({
      negocio: "Loves Stories",
      vendedor: vendedor?.name ?? "Vendedor eliminado",
      fecha: new Date(sesion.started_at).toLocaleDateString("es-BO"),
      horaInicio: new Date(sesion.started_at).toLocaleTimeString("es-BO").slice(0, 5),
      horaFin: sesion.ended_at ? new Date(sesion.ended_at).toLocaleTimeString("es-BO").slice(0, 5) : "En curso",
      lineas: Object.values(lineasPorProducto),
      totalVendido, devoluciones, ventaNeta, comisionTexto, comision,
    });
    setGenerandoSesion(null);
  }

  async function calcular() {
    if (vendedores.length === 0 && desde && hasta) {
      // aún puede haber ítems "Catálogo / Sin vendedor" incluso sin vendedores creados
    }
    setCargando(true);
    const reglas: PricingRule[] = await loadPricingRules();
    const desdeIso = new Date(desde + "T00:00:00").toISOString();
    const hastaIso = new Date(hasta + "T23:59:59").toISOString();

    const { data: itemsRango } = await supabase
      .from("order_items")
      .select("id, order_id, product_id, quantity, unit_price, assigned_at, seller_id, origin, products(code, name, category_id)")
      .gte("assigned_at", desdeIso)
      .lte("assigned_at", hastaIso);

    const filasRango = itemsRango ?? [];
    const ordenIds = Array.from(new Set(filasRango.map((f: any) => f.order_id)));

    const mapaEstado: Record<string, string> = {};
    const itemsPorOrden: Record<string, any[]> = {};
    if (ordenIds.length > 0) {
      const { data: ordenes } = await supabase.from("orders").select("id, status").in("id", ordenIds);
      (ordenes ?? []).forEach((o: any) => (mapaEstado[o.id] = o.status));

      const { data: todosItems } = await supabase
        .from("order_items")
        .select("id, order_id, product_id, quantity, unit_price, assigned_at, seller_id, products(code, name, category_id)")
        .in("order_id", ordenIds);
      (todosItems ?? []).forEach((it: any) => {
        itemsPorOrden[it.order_id] = itemsPorOrden[it.order_id] || [];
        itemsPorOrden[it.order_id].push(it);
      });
    }

    // Devoluciones activas de tipo 'producto', indexadas por order_item_id.
    const { data: devs } = ordenIds.length > 0
      ? await supabase.from("return_items").select("order_item_id, amount, quantity, returns!inner(status, type, order_id)").eq("returns.status", "activa").eq("returns.type", "producto").in("returns.order_id", ordenIds)
      : { data: [] as any[] };
    const devueltoPorItem: Record<string, { amount: number; quantity: number }> = {};
    (devs ?? []).forEach((d: any) => {
      const actual = devueltoPorItem[d.order_item_id] ?? { amount: 0, quantity: 0 };
      devueltoPorItem[d.order_item_id] = { amount: actual.amount + d.amount, quantity: actual.quantity + d.quantity };
    });

    const resultado: Record<string, FilaVendedor> = {};
    function fila(sellerId: string | null, nombre: string): FilaVendedor {
      if (!resultado[sellerId ?? "null"]) {
        resultado[sellerId ?? "null"] = { sellerId, nombre, unidadesAsignadas: 0, unidadesNetas: 0, ventaBruta: 0, devoluciones: 0, ventaNeta: 0, comision: 0, comisionTexto: "" };
      }
      return resultado[sellerId ?? "null"];
    }

    for (const row of filasRango) {
      const nombreVendedor = row.seller_id ? (vendedores.find((v) => v.id === row.seller_id)?.name ?? "Vendedor eliminado") : (row.origin === "catalogo" ? "Catálogo / Sin vendedor" : "Sin vendedor");
      const f = fila(row.seller_id, nombreVendedor);
      f.unidadesAsignadas += row.quantity;

      const estado = mapaEstado[row.order_id];
      if (estado !== "closed") continue; // "venta neta atribuible" solo cuenta pedidos cerrados

      const itemsDeEsaOrden: LineaPedido[] = (itemsPorOrden[row.order_id] ?? []).map((it: any) => ({
        id: it.id, product_id: it.product_id, codigo: it.products?.code ?? "", nombre: it.products?.name ?? "",
        categoria_id: it.products?.category_id ?? null, cantidad: it.quantity, precio_base: it.unit_price, fecha: it.assigned_at,
      }));
      const grupos = agruparPorProducto(reglas, itemsDeEsaOrden);
      const grupo = grupos.find((g) => g.product_id === row.product_id);
      const precioFinal = grupo?.precioUnitarioFinal ?? row.unit_price;

      const dev = devueltoPorItem[row.id] ?? { amount: 0, quantity: 0 };
      const bruta = precioFinal * row.quantity;
      f.ventaBruta += bruta;
      f.devoluciones += dev.amount;
      f.unidadesNetas += row.quantity - dev.quantity;
    }

    for (const key of Object.keys(resultado)) {
      const f = resultado[key];
      f.ventaNeta = f.ventaBruta - f.devoluciones;
      const vendedor = f.sellerId ? vendedores.find((v) => v.id === f.sellerId) : null;
      if (!vendedor || vendedor.commission_type === "none") {
        f.comisionTexto = "Comisión no configurada";
        f.comision = 0;
      } else if (vendedor.commission_type === "percentage") {
        f.comision = f.ventaNeta * (vendedor.commission_value / 100);
        f.comisionTexto = `${vendedor.commission_value}% sobre venta neta`;
      } else {
        f.comision = f.unidadesNetas * vendedor.commission_value;
        f.comisionTexto = `Bs ${vendedor.commission_value} × unidad neta`;
      }
    }

    setFilas(Object.values(resultado).sort((a, b) => b.ventaNeta - a.ventaNeta));
    setCargando(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="font-serif text-lg flex items-center gap-2"><BadgePercent size={18} /> Reporte de vendedores</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
            <Calendar size={13} style={{ color: "#5B4E5E" }} />
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="text-xs outline-none bg-transparent" />
          </div>
          <span className="text-xs" style={{ color: "#5B4E5E" }}>a</span>
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="text-xs outline-none bg-transparent" />
          </div>
        </div>
      </div>

      <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>
        "Asignado" cuenta todo lo que se agregó en este rango, esté o no cerrado el pedido. "Venta neta atribuible" y la
        comisión solo cuentan pedidos ya <strong>cerrados</strong>, y ya descuentan las devoluciones de ese vendedor.
      </p>

      {cargando ? (
        <p className="text-sm" style={{ color: "#5B4E5E" }}>Calculando…</p>
      ) : (
        <div className="flex flex-col gap-3 mb-5">
          {filas.map((f) => (
            <div key={f.sellerId ?? "null"} className="p-4 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              <p className="font-serif text-base mb-2">{f.nombre}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
                <span style={{ color: "#5B4E5E" }}>Asignado: {f.unidadesAsignadas} un.</span>
                <span style={{ color: "#5B4E5E" }}>Neto vendido: {f.unidadesNetas} un.</span>
                <span>Venta bruta: Bs {f.ventaBruta.toFixed(2)}</span>
                <span style={{ color: "#7A2540" }}>Devoluciones: Bs {f.devoluciones.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid #D9D0C2" }}>
                <span className="text-sm">Venta neta atribuible: <strong>Bs {f.ventaNeta.toFixed(2)}</strong></span>
                <span className="text-sm" style={{ color: f.comisionTexto === "Comisión no configurada" ? "#7A5F2D" : "#4F6F52" }}>
                  {f.comisionTexto === "Comisión no configurada" ? f.comisionTexto : `Comisión (${f.comisionTexto}): Bs ${f.comision.toFixed(2)}`}
                </span>
              </div>
            </div>
          ))}
          {filas.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>No hay asignaciones en este rango de fechas.</p>}
        </div>
      )}

      <p className="font-serif text-base mb-2">Sesiones / turnos</p>
      <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        {sesiones.map((s, i) => {
          const vendedor = vendedores.find((v) => v.id === s.seller_id);
          return (
            <div key={s.id} className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: i < sesiones.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <div>
                <p className="text-sm">{vendedor?.name ?? "Vendedor eliminado"}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>
                  {new Date(s.started_at).toLocaleDateString("es-BO")} · {new Date(s.started_at).toLocaleTimeString("es-BO").slice(0, 5)} — {s.ended_at ? new Date(s.ended_at).toLocaleTimeString("es-BO").slice(0, 5) : "en curso"}
                </p>
              </div>
              <button onClick={() => generarPdfDeSesion(s)} disabled={generandoSesion === s.id} className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                <FileDown size={12} /> {generandoSesion === s.id ? "Generando..." : "PDF de sesión"}
              </button>
            </div>
          );
        })}
        {sesiones.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>No hay sesiones registradas en este rango.</p>}
      </div>
    </div>
  );
}
