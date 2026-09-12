import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Minus, Plus, Pencil } from "lucide-react";
import { supabase } from "../lib/supabase";
import { loadPricingRules, precioUnitario, PricingRule } from "../lib/pricing";

interface ItemVenta {
  id: string;
  product_id: string;
  codigo: string;
  nombre: string;
  categoria_id: string | null;
  cantidad: number;
  precio_base: number;
}

interface VentaCerrada {
  id: string;
  order_number: number;
  cliente: string;
  telefono: string;
  closed_at: string;
  items: ItemVenta[];
}

export default function Ventas() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [ventas, setVentas] = useState<VentaCerrada[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [codigoNuevo, setCodigoNuevo] = useState("");
  const [cantidadNueva, setCantidadNueva] = useState(1);

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
      .select("id, order_number, closed_at, customers(name, phone), order_items(id, product_id, quantity, unit_price, products(code, name, category_id))")
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
      items: (o.order_items ?? []).map((it: any) => ({
        id: it.id,
        product_id: it.product_id,
        codigo: it.products?.code ?? "",
        nombre: it.products?.name ?? "",
        categoria_id: it.products?.category_id ?? null,
        cantidad: it.quantity,
        precio_base: it.unit_price,
      })),
    }));
    setVentas(lista);
  }

  function calcularVenta(v: VentaCerrada) {
    const subtotal = v.items.reduce((a, it) => a + it.precio_base * it.cantidad, 0);
    const total = v.items.reduce((a, it) => a + precioUnitario(reglas, it.categoria_id, it.cantidad, it.precio_base) * it.cantidad, 0);
    const unidades = v.items.reduce((a, it) => a + it.cantidad, 0);
    return { subtotal, total, descuento: subtotal - total, unidades };
  }

  const resumenDia = useMemo(() => {
    return ventas.reduce(
      (acc, v) => {
        const c = calcularVenta(v);
        return { total: acc.total + c.total, descuento: acc.descuento + c.descuento, unidades: acc.unidades + c.unidades };
      },
      { total: 0, descuento: 0, unidades: 0 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventas, reglas]);

  async function quitarUnidad(orderId: string, itemId: string) {
    await supabase.rpc("remove_order_item_unit", { p_order_item_id: itemId, p_quantity: 1 });
    cargar();
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
    cargar();
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

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Total del día</p>
          <p className="font-serif text-lg">Bs {resumenDia.total.toLocaleString("es-BO")}</p>
        </div>
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Descontado por cantidad</p>
          <p className="font-serif text-lg" style={{ color: "#4F6F52" }}>Bs {resumenDia.descuento.toLocaleString("es-BO")}</p>
        </div>
        <div className="p-3 rounded-md text-center" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>Unidades vendidas</p>
          <p className="font-serif text-lg">{resumenDia.unidades}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {ventas.map((v) => {
          const c = calcularVenta(v);
          const abierto = editando === v.id;
          return (
            <div key={v.id} className="p-4 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-medium">Pedido #{v.order_number} · {v.cliente}</p>
                  <p className="text-xs" style={{ color: "#5B4E5E" }}>{v.telefono} · cerrado {new Date(v.closed_at).toLocaleString("es-BO")}</p>
                </div>
                <button onClick={() => setEditando(abierto ? null : v.id)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                  <Pencil size={12} /> {abierto ? "Cerrar edición" : "Editar"}
                </button>
              </div>

              <div style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} className="rounded mb-2">
                {v.items.map((it, i) => (
                  <div key={it.id} className="flex items-center justify-between px-3 py-2" style={{ borderBottom: i < v.items.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                    <span className="text-sm">{it.codigo} · {it.nombre} × {it.cantidad}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-serif">Bs {precioUnitario(reglas, it.categoria_id, it.cantidad, it.precio_base) * it.cantidad}</span>
                      {abierto && (
                        <button onClick={() => quitarUnidad(v.id, it.id)} title="Quitar una unidad (regresa al inventario)" className="p-1 rounded" style={{ color: "#7A2540" }}>
                          <Minus size={13} />
                        </button>
                      )}
                    </div>
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
                    <Plus size={13} /> Agregar a esta venta
                  </button>
                </div>
              )}

              <div className="flex justify-between text-sm pt-2" style={{ borderTop: "1px solid #D9D0C2" }}>
                <span style={{ color: "#5B4E5E" }}>Descuento por cantidad: Bs {c.descuento} · {c.unidades} unidades</span>
                <span className="font-serif">Total: Bs {c.total}</span>
              </div>
            </div>
          );
        })}
        {ventas.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>No hay ventas cerradas en esta fecha.</p>}
      </div>
    </div>
  );
}
