import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Minus, Plus, Pencil, FileDown, RotateCcw, Undo2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { loadPricingRules, agruparPorProducto, PricingRule, LineaPedido } from "../lib/pricing";
import { generarPdfPedido, generarPdfDevolucion } from "../lib/pdf";
import type { Devolucion, DevolucionItem } from "../lib/types";

interface VentaCerrada {
  id: string;
  order_number: number;
  cliente: string;
  telefono: string;
  closed_at: string;
  total_cerrado: number | null;
  items: LineaPedido[];
}

const MOTIVOS = ["Producto roto", "Producto defectuoso", "Producto equivocado", "Otro"];

export default function Ventas() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [ventas, setVentas] = useState<VentaCerrada[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [codigoNuevo, setCodigoNuevo] = useState("");
  const [cantidadNueva, setCantidadNueva] = useState(1);
  const [devoluciones, setDevoluciones] = useState<Record<string, (Devolucion & { items: DevolucionItem[] })[]>>({});
  const [pagos, setPagos] = useState<Record<string, number>>({});
  const [banner, setBanner] = useState<{ orderId: string; original: number; anterior: number; nuevo: number; pagado: number; diferencia: number } | null>(null);
  const [mostrarDevolucion, setMostrarDevolucion] = useState<string | null>(null);
  const [devItemId, setDevItemId] = useState("");
  const [devCantidad, setDevCantidad] = useState(1);
  const [devMonto, setDevMonto] = useState(0);
  const [devMotivo, setDevMotivo] = useState(MOTIVOS[0]);
  const [devRestock, setDevRestock] = useState<"si" | "no" | "">("");
  const [devObs, setDevObs] = useState("");

  useEffect(() => {
    loadPricingRules().then(setReglas);
  }, []);

  useEffect(() => {
    cargar();
  }, [fecha]);

  async function cargar() {
    const desde = new Date(fecha + "T00:00:00");
    const hasta = new Date(fecha + "T23:59:59");
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, closed_at, total_cerrado, customers(name, phone), order_items(id, product_id, quantity, unit_price, assigned_at, products(code, name, category_id))")
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
        cantidad: it.quantity,
        precio_base: it.unit_price,
        fecha: new Date(it.assigned_at).toLocaleDateString("es-BO"),
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
    const reembolsoCorreccion = devsActivas.filter((d) => d.type === "correccion").reduce((a, d) => a + d.total_amount, 0);
    const neta = bruta - devolucionProducto;
    const cobrado = pagos[v.id] ?? 0;
    // Cobro neto sí resta ambos: los dos son dinero que salió de la caja.
    const cobroNeto = cobrado - devolucionProducto - reembolsoCorreccion;
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

  async function quitarUnidad(orderId: string, itemId: string) {
    await supabase.rpc("remove_order_item_unit", { p_order_item_id: itemId, p_quantity: 1 });
    await recalcular(orderId);
  }

  async function agregarItem(orderId: string) {
    if (!codigoNuevo.trim()) return;
    const { data: producto } = await supabase.from("products").select("id").eq("code", codigoNuevo.trim()).is("deleted_at", null).maybeSingle();
    if (!producto) { alert("No se encontró ese código en el inventario."); return; }
    const { error } = await supabase.rpc("assign_product_to_order", {
      p_order_id: orderId, p_product_id: producto.id, p_quantity: cantidadNueva, p_origin: "correccion",
    });
    if (error) { alert(error.message); return; }
    setCodigoNuevo("");
    setCantidadNueva(1);
    await recalcular(orderId);
  }

  // Después de cualquier corrección (agregar/quitar producto), se recalcula el
  // total EN SUPABASE y se muestra la diferencia frente a lo ya pagado — la
  // decisión de qué hacer con esa diferencia la tomas tú, nunca es automática.
  async function recalcular(orderId: string) {
    const { data, error } = await supabase.rpc("recalcular_total_venta", { p_order_id: orderId }).single();
    if (error) { alert(error.message); await cargar(); return; }
    const r = data as any;
    setBanner({ orderId, original: r.total_original ?? r.total_anterior ?? 0, anterior: r.total_anterior ?? 0, nuevo: r.total_nuevo, pagado: r.pagado, diferencia: r.diferencia });
    await cargar();
  }

  async function registrarDevolucionCorreccion() {
    if (!banner || banner.diferencia <= 0) return;
    await supabase.rpc("registrar_devolucion_correccion", {
      p_order_id: banner.orderId, p_amount: banner.diferencia, p_observation: "Ajuste por corrección de registro",
    });
    setBanner(null);
    cargar();
  }

  async function registrarCobroAdicional() {
    if (!banner || banner.diferencia >= 0) return;
    const venta = ventas.find((v) => v.id === banner.orderId);
    if (!venta) return;
    const { data: orden } = await supabase.from("orders").select("customer_id").eq("id", banner.orderId).single();
    if (!orden) return;
    await supabase.from("payments").insert({
      customer_id: orden.customer_id, order_id: banner.orderId, amount: -banner.diferencia, method: "correccion_cobro",
    });
    setBanner(null);
    cargar();
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
    generarPdfPedido({
      negocio: "Loves Stories",
      cliente: v.cliente,
      telefono: v.telefono,
      fecha: new Date(v.closed_at).toLocaleDateString("es-BO"),
      grupos: t.grupos,
      subtotalSinDescuento: t.grupos.reduce((a, g) => a + g.subtotalSinDescuento, 0),
      descuentoTotal: t.grupos.reduce((a, g) => a + g.descuento, 0),
      total: t.bruta,
      depositado: t.cobrado,
      saldo: 0,
      cerrado: true,
      pagoFinal: 0,
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Ventas</p>
        <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <Calendar size={14} style={{ color: "#5B4E5E" }} />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="text-sm outline-none bg-transparent" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Venta bruta</p>
          <p className="font-serif text-lg">Bs {resumenDia.bruta.toFixed(2)}</p>
        </div>
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Devolución de producto</p>
          <p className="font-serif text-lg" style={{ color: "#7A2540" }}>Bs {resumenDia.devolucionProducto.toFixed(2)}</p>
        </div>
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Reembolso por corrección</p>
          <p className="font-serif text-lg" style={{ color: "#7A5F2D" }}>Bs {resumenDia.reembolsoCorreccion.toFixed(2)}</p>
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
          const devs = devoluciones[v.id] ?? [];
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
                  <button onClick={() => abrirDevolucion(v)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#F4E3E6", color: "#7A2540" }}>
                    <Undo2 size={12} /> Registrar devolución
                  </button>
                  <button onClick={() => setEditando(abierto ? null : v.id)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
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
                          <button onClick={() => quitarUnidad(v.id, g.detalle[g.detalle.length - 1].id)} title="Quitar una unidad (corrección)" className="p-1 rounded" style={{ color: "#7A2540" }}>
                            <Minus size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs" style={{ color: "#5B4E5E" }}>{g.detalle.map((d) => `${d.cantidad} un. — ${d.fecha}`).join(" · ")}</p>
                  </div>
                ))}
              </div>

              {abierto && (
                <div className="flex items-end gap-2 mb-2 p-2 rounded" style={{ background: "#EDE7DE" }}>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Código a agregar</p>
                    <input value={codigoNuevo} onChange={(e) => setCodigoNuevo(e.target.value)} className="w-28 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Cantidad</p>
                    <input type="number" min={1} value={cantidadNueva} onChange={(e) => setCantidadNueva(Math.max(1, Number(e.target.value)))} className="w-16 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                  <button onClick={() => agregarItem(v.id)} className="text-xs px-3 py-2 rounded-md flex items-center gap-1" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                    <Plus size={13} /> Agregar (corrección)
                  </button>
                </div>
              )}

              {banner && banner.orderId === v.id && (
                <div className="p-3 mb-2 rounded-md" style={{ background: "#F6EAD2", border: "1px solid #B7791F" }}>
                  <p className="text-xs mb-2" style={{ color: "#7A5F2D" }}>
                    Total original (con el que se cerró): Bs {banner.original.toFixed(2)} · Total corregido: Bs {banner.nuevo.toFixed(2)} ·
                    Pagado: Bs {banner.pagado.toFixed(2)} · Diferencia: Bs {banner.diferencia.toFixed(2)}
                  </p>
                  {banner.diferencia > 0 ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs" style={{ color: "#7A2540" }}>El cliente pagó de más — se le debe devolver Bs {banner.diferencia.toFixed(2)}. Esto NO se vuelve a restar de la venta neta (el total corregido ya la refleja).</p>
                      <button onClick={registrarDevolucionCorreccion} className="text-xs px-3 py-1.5 rounded-md shrink-0" style={{ background: "#7A2540", color: "#F7F3EC" }}>
                        Registrar reembolso de Bs {banner.diferencia.toFixed(2)}
                      </button>
                    </div>
                  ) : banner.diferencia < 0 ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs" style={{ color: "#4F6F52" }}>El total subió — al cliente le falta pagar Bs {(-banner.diferencia).toFixed(2)}.</p>
                      <button onClick={registrarCobroAdicional} className="text-xs px-3 py-1.5 rounded-md shrink-0" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
                        Registrar cobro adicional de Bs {(-banner.diferencia).toFixed(2)}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: "#4F6F52" }}>El total no cambió respecto a lo pagado.</p>
                  )}
                  <button onClick={() => setBanner(null)} className="text-xs mt-1.5 underline" style={{ color: "#7A5F2D" }}>Cerrar aviso</button>
                </div>
              )}

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

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs pt-2" style={{ borderTop: "1px solid #D9D0C2" }}>
                <span style={{ color: "#5B4E5E" }}>Bruta: Bs {t.bruta.toFixed(2)}</span>
                <span style={{ color: "#7A2540" }}>Dev. producto: Bs {t.devolucionProducto.toFixed(2)}</span>
                <span style={{ color: "#7A5F2D" }}>Reembolso corr.: Bs {t.reembolsoCorreccion.toFixed(2)}</span>
                <span style={{ color: "#4F6F52" }}>Neta: Bs {t.neta.toFixed(2)}</span>
                <span className="font-serif">Cobro neto: Bs {t.cobroNeto.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
        {ventas.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>No hay ventas cerradas en esta fecha.</p>}
      </div>
    </div>
  );
}
