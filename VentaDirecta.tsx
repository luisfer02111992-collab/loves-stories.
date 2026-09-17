import React, { useEffect, useMemo, useState } from "react";
import { Search, ShoppingCart, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSellerSession } from "../hooks/useSellerSession";
import { loadPricingRules, agruparPorProducto, PricingRule, LineaPedido } from "../lib/pricing";
import type { Product } from "../lib/types";

export default function VentaDirecta() {
  const { vendedorActivoId, vendedorActivoNombre, sesionActivaId } = useSellerSession();
  const [productos, setProductos] = useState<Product[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [mostrarLista, setMostrarLista] = useState(false);
  const [cantidad, setCantidad] = useState(1);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [items, setItems] = useState<LineaPedido[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [nombreCliente, setNombreCliente] = useState("");
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [finalizando, setFinalizando] = useState(false);
  const [ultimaVenta, setUltimaVenta] = useState<{ total: number; numero: number } | null>(null);

  useEffect(() => {
    cargarProductos();
    loadPricingRules().then(setReglas);
  }, []);

  async function cargarProductos() {
    const { data } = await supabase.from("products").select("*").is("deleted_at", null).gt("stock_available", 0).order("name");
    setProductos((data as Product[]) ?? []);
  }

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return productos.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [busqueda, productos]);

  async function obtenerOrden(): Promise<string> {
    if (orderId) return orderId;
    const { data, error } = await supabase
      .from("orders")
      .insert({ customer_id: null, direct_sale: true, direct_sale_name: nombreCliente || null })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message ?? "No se pudo iniciar la venta directa");
    setOrderId(data.id);
    return data.id;
  }

  async function cargarItems(id: string) {
    const { data: filas } = await supabase
      .from("order_items")
      .select("id, product_id, quantity, unit_price, assigned_at, products(code, name, category_id)")
      .eq("order_id", id)
      .order("assigned_at", { ascending: true });
    setItems((filas ?? []).map((f: any) => ({
      id: f.id, product_id: f.product_id, codigo: f.products?.code ?? "", nombre: f.products?.name ?? "",
      categoria_id: f.products?.category_id ?? null, cantidad: f.quantity, precio_base: f.unit_price,
      fecha: new Date(f.assigned_at).toLocaleTimeString("es-BO").slice(0, 5),
    })));
  }

  async function agregar(p: Product) {
    try {
      const id = await obtenerOrden();
      const { error } = await supabase.rpc("assign_product_to_order", {
        p_order_id: id, p_product_id: p.id, p_quantity: cantidad, p_origin: "manual",
        p_seller_id: vendedorActivoId, p_session_id: sesionActivaId,
      });
      if (error) { alert(error.message); return; }
      setBusqueda(""); setMostrarLista(false); setCantidad(1);
      cargarItems(id);
      cargarProductos();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function quitarUnidad(itemId: string) {
    await supabase.rpc("remove_order_item_unit", { p_order_item_id: itemId, p_quantity: 1 });
    if (orderId) cargarItems(orderId);
    cargarProductos();
  }

  const grupos = useMemo(() => agruparPorProducto(reglas, items), [items, reglas]);
  const subtotalSinDescuento = grupos.reduce((a, g) => a + g.subtotalSinDescuento, 0);
  const total = grupos.reduce((a, g) => a + g.subtotalConDescuento, 0);
  const descuentoTotal = subtotalSinDescuento - total;

  async function finalizarVenta() {
    if (!orderId || items.length === 0) return;
    setFinalizando(true);
    const { data: totalReal, error: errCalc } = await supabase.rpc("calcular_total_pedido", { p_order_id: orderId });
    if (errCalc) { alert(errCalc.message); setFinalizando(false); return; }
    if ((totalReal ?? 0) > 0) {
      await supabase.from("payments").insert({ customer_id: null, order_id: orderId, amount: totalReal, method: metodoPago });
    }
    const { error } = await supabase.rpc("close_order", { p_order_id: orderId });
    setFinalizando(false);
    if (error) { alert(error.message); return; }

    const { data: orden } = await supabase.from("orders").select("order_number").eq("id", orderId).single();
    setUltimaVenta({ total: totalReal ?? 0, numero: orden?.order_number ?? 0 });
    setOrderId(null);
    setItems([]);
    setNombreCliente("");
    cargarProductos();
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <p className="font-serif text-lg mb-1 flex items-center gap-2"><ShoppingCart size={18} /> Venta directa</p>
        <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>Venta al mostrador, sin necesidad de cliente registrado ni apertura previa.</p>

        {ultimaVenta && (
          <div className="p-3 mb-3 rounded-md" style={{ background: "#E4EBE1", border: "1px solid #4F6F52" }}>
            <p className="text-xs" style={{ color: "#4F6F52" }}>Venta directa #{ultimaVenta.numero} finalizada — Total Bs {ultimaVenta.total.toFixed(2)}</p>
          </div>
        )}

        <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-1.5" style={{ color: "#5B4E5E" }}>Nombre del cliente (opcional)</p>
          <input value={nombreCliente} onChange={(e) => setNombreCliente(e.target.value)} placeholder="Sin nombre"
            className="w-full px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
        </div>

        <div className="p-4 mb-3 relative" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-1.5" style={{ color: "#5B4E5E" }}>Buscar producto</p>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
              <Search size={14} style={{ color: "#5B4E5E" }} />
              <input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setMostrarLista(true); }} onFocus={() => setMostrarLista(true)}
                placeholder="Código o descripción…" className="flex-1 text-sm outline-none bg-transparent" />
            </div>
            <input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 px-2 py-2 rounded text-sm text-center outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
          </div>
          {mostrarLista && coincidencias.length > 0 && (
            <div className="absolute left-4 right-4 mt-1 rounded-md z-10 shadow-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              {coincidencias.map((p) => (
                <button key={p.id} onClick={() => agregar(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                  {p.code} · {p.name} — Bs {p.price} <span style={{ color: "#5B4E5E" }}>({p.stock_available} disp.)</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {grupos.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Busca y agrega productos para iniciar la venta.</p>}
          {grupos.map((g, i) => (
            <div key={g.product_id} className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: i < grupos.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <div>
                <p className="text-sm">{g.codigo} · {g.nombre} × {g.cantidadTotal}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>{g.detalle.map((d) => `${d.cantidad} un. — ${d.fecha}`).join(" · ")}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-serif text-sm">Bs {g.subtotalConDescuento.toFixed(2)}</span>
                <button onClick={() => quitarUnidad(g.detalle[g.detalle.length - 1].id)} className="p-1 rounded" style={{ color: "#7A2540" }} title="Quitar una unidad">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>
          {vendedorActivoNombre ? `Vendedor: ${vendedorActivoNombre}` : "Sin vendedor activo"}
        </p>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Subtotal</span><span>Bs {subtotalSinDescuento.toFixed(2)}</span></div>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#4F6F52" }}>Descuento</span><span style={{ color: "#4F6F52" }}>− Bs {descuentoTotal.toFixed(2)}</span></div>
        <div className="flex justify-between text-sm pt-1.5 mb-3" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>TOTAL</span><span className="font-serif">Bs {total.toFixed(2)}</span></div>

        <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Método de pago</p>
        <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full mb-3 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="qr">QR</option>
        </select>

        <button onClick={finalizarVenta} disabled={items.length === 0 || finalizando}
          className="w-full py-2.5 rounded-md text-sm" style={{ background: items.length > 0 ? "#2B1E2E" : "#D9D0C2", color: "#F7F3EC" }}>
          {finalizando ? "Finalizando..." : "Finalizar venta"}
        </button>
      </div>
    </div>
  );
}
