import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, Search, ScanBarcode, Camera, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSellerSession } from "../hooks/useSellerSession";
import { loadPricingRules, agruparPorProducto, PricingRule, LineaPedido } from "../lib/pricing";
import type { Customer, Product } from "../lib/types";

export default function Asignacion() {
  const { vendedorActivoId, vendedorActivoNombre, sesionActivaId } = useSellerSession();
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [clienteId, setClienteId] = useState<string>("");
  const [codigo, setCodigo] = useState("");
  const [productoEncontrado, setProductoEncontrado] = useState<Product | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [cantidad, setCantidad] = useState(1);
  const [buscarFoto, setBuscarFoto] = useState(false);
  const [items, setItems] = useState<LineaPedido[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [filaSeleccionada, setFilaSeleccionada] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => {
      setClientes((data as Customer[]) ?? []);
      if (data && data.length > 0) setClienteId((data[0] as Customer).id);
    });
    loadPricingRules().then(setReglas);
  }, []);

  useEffect(() => {
    if (clienteId) cargarPedidoDeHoy(clienteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  async function cargarPedidoDeHoy(customerId: string) {
    const { data: orden } = await supabase
      .from("orders").select("id").eq("customer_id", customerId).in("status", ["open", "reopened"])
      .order("opened_at", { ascending: false }).limit(1).maybeSingle();
    if (!orden) { setItems([]); return; }
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const { data: filas } = await supabase
      .from("order_items")
      .select("id, product_id, quantity, unit_price, assigned_at, products(code, name, category_id)")
      .eq("order_id", orden.id)
      .gte("assigned_at", hoy.toISOString())
      .order("assigned_at", { ascending: true });
    setItems((filas ?? []).map((f: any) => ({
      id: f.id, product_id: f.product_id, codigo: f.products?.code ?? "", nombre: f.products?.name ?? "",
      categoria_id: f.products?.category_id ?? null, cantidad: f.quantity, precio_base: f.unit_price,
      fecha: new Date(f.assigned_at).toLocaleTimeString("es-BO").slice(0, 5),
    })));
  }

  async function obtenerOrdenAbierta(customerId: string) {
    const { data: existente } = await supabase
      .from("orders").select("id").eq("customer_id", customerId).in("status", ["open", "reopened"]).maybeSingle();
    if (existente) return existente.id as string;
    const { data: nueva } = await supabase.from("orders").insert({ customer_id: customerId }).select().single();
    return nueva!.id as string;
  }

  // Escribir/escanear el código YA NO asigna nada — solo busca y muestra el
  // producto. Hace falta presionar "Asignar" (o Enter, que hace lo mismo)
  // para que la unidad se descuente del inventario de verdad.
  async function buscarProducto(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim() || buscando) return;
    setBuscando(true);
    setNoEncontrado(false);
    const { data: producto } = await supabase.from("products").select("*").eq("code", codigo.trim()).is("deleted_at", null).maybeSingle();
    setBuscando(false);
    if (!producto) {
      setProductoEncontrado(null);
      setNoEncontrado(true);
      return;
    }
    setProductoEncontrado(producto as Product);
    setCantidad(1);
  }

  // Confirmar con el botón "Asignar" (o Enter dentro del formulario de
  // confirmación) es el ÚNICO momento en que se descuenta stock de verdad.
  async function confirmarAsignacion(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!productoEncontrado || !clienteId || enviando) return;
    setEnviando(true);
    const orderId = await obtenerOrdenAbierta(clienteId);
    const { error } = await supabase.rpc("assign_product_to_order", {
      p_order_id: orderId,
      p_product_id: productoEncontrado.id,
      p_quantity: cantidad,
      p_origin: "manual",
      p_seller_id: vendedorActivoId,
      p_session_id: sesionActivaId,
    });
    setEnviando(false);
    if (error) {
      alert(error.message);
      return;
    }
    setCodigo("");
    setProductoEncontrado(null);
    setCantidad(1);
    setNoEncontrado(false);
    setBuscarFoto(false);
    inputRef.current?.focus();
    cargarPedidoDeHoy(clienteId);
  }

  function cancelarBusqueda() {
    setCodigo("");
    setProductoEncontrado(null);
    setNoEncontrado(false);
    inputRef.current?.focus();
  }

  // + / − sobre una fila ya asignada: cada click es una operación real e
  // inmediata contra Supabase (aumentar descuenta la diferencia, o sea 1
  // unidad más; disminuir devuelve 1 unidad al inventario).
  async function aumentarUnidad(grupoProductId: string) {
    if (!clienteId) return;
    setEnviando(true);
    const orderId = await obtenerOrdenAbierta(clienteId);
    await supabase.rpc("assign_product_to_order", {
      p_order_id: orderId, p_product_id: grupoProductId, p_quantity: 1, p_origin: "manual",
      p_seller_id: vendedorActivoId, p_session_id: sesionActivaId,
    });
    setEnviando(false);
    cargarPedidoDeHoy(clienteId);
  }

  async function disminuirUnidad(ultimoItemId: string) {
    await supabase.rpc("remove_order_item_unit", { p_order_item_id: ultimoItemId, p_quantity: 1 });
    cargarPedidoDeHoy(clienteId);
  }

  // Supr/Delete sobre la fila seleccionada quita el producto COMPLETO y
  // devuelve todas sus unidades al inventario (una llamada por cada línea
  // interna que compone el grupo, para no perder el historial de fechas).
  async function quitarProductoCompleto(grupo: ReturnType<typeof agruparPorProducto>[number]) {
    if (!confirm(`¿Quitar "${grupo.nombre}" completo (${grupo.cantidadTotal} unidades) de este pedido? Se devuelve todo al inventario.`)) return;
    for (const d of grupo.detalle) {
      await supabase.rpc("remove_order_item_unit", { p_order_item_id: d.id, p_quantity: d.cantidad });
    }
    setFilaSeleccionada(null);
    cargarPedidoDeHoy(clienteId);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && filaSeleccionada) {
        const activo = document.activeElement;
        const enCampoDeTexto = activo && (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA" || activo.tagName === "SELECT");
        if (enCampoDeTexto) return;
        e.preventDefault();
        const g = grupos.find((x) => x.product_id === filaSeleccionada);
        if (g) quitarProductoCompleto(g);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filaSeleccionada, items]);

  const grupos = useMemo(() => agruparPorProducto(reglas, items), [items, reglas]);
  const total = grupos.reduce((a, g) => a + g.subtotalConDescuento, 0);
  const unidades = grupos.reduce((a, g) => a + g.cantidadTotal, 0);

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-xs" style={{ color: "#5B4E5E" }}>
            {vendedorActivoNombre ? `Vendedor: ${vendedorActivoNombre}` : "Sin vendedor activo (elige uno arriba si corresponde)"}
          </span>
        </div>

        <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-1.5" style={{ color: "#5B4E5E" }}>Cliente</p>
          <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            <Search size={14} style={{ color: "#5B4E5E" }} />
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="flex-1 text-sm outline-none bg-transparent">
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {!productoEncontrado ? (
          <form onSubmit={buscarProducto} className="p-4 rounded-md mb-3" style={{ background: "#2B1E2E" }}>
            <p className="text-xs mb-2 flex items-center gap-1.5" style={{ color: "#C9BFC7" }}><ScanBarcode size={14} /> Escanear o escribir código — Enter para buscar</p>
            <div className="flex gap-2">
              <input ref={inputRef} autoFocus value={codigo} onChange={(e) => { setCodigo(e.target.value); setNoEncontrado(false); }} placeholder="80-50"
                className="flex-1 px-3 py-3 rounded text-lg outline-none" style={{ background: "#F7F3EC", color: "#2B1E2E" }} />
              <button type="submit" disabled={buscando} className="px-5 rounded flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                <Search size={16} /> Buscar
              </button>
              <button type="button" onClick={() => setBuscarFoto((v) => !v)} className="px-3 rounded flex items-center gap-1.5" style={{ background: buscarFoto ? "#B7791F" : "#F7F3EC", color: buscarFoto ? "#F7F3EC" : "#2B1E2E" }}>
                <Camera size={16} />
              </button>
            </div>

            {noEncontrado && (
              <div className="mt-3 p-3 rounded" style={{ background: "#F4E3E6" }}>
                <p className="text-xs" style={{ color: "#7A2540" }}>No se encontró ningún producto con ese código. Prueba la búsqueda por foto (cámara), o verifica el código.</p>
              </div>
            )}
            {buscarFoto && (
              <div className="mt-3 p-3 rounded" style={{ background: "#F7F3EC" }}>
                <label className="flex items-center gap-2 px-3 py-3 rounded mb-2 cursor-pointer justify-center text-sm" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C", color: "#7A5F2D" }}>
                  <Camera size={16} /> Tomar o subir foto del producto
                  <input type="file" accept="image/*" capture="environment" className="hidden" />
                </label>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>
                  Esta función de búsqueda por similitud de imagen todavía no está conectada a un servicio real de reconocimiento.
                </p>
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={confirmarAsignacion} className="p-4 rounded-md mb-3" style={{ background: "#F6EAD2", border: "1px solid #B7791F" }}>
            <p className="text-xs mb-1" style={{ color: "#7A5F2D" }}>Producto encontrado — confirma para asignar (no se ha descontado nada todavía)</p>
            <p className="text-sm font-medium mb-2">{productoEncontrado.code} · {productoEncontrado.name} — Bs {productoEncontrado.price} <span className="text-xs" style={{ color: "#5B4E5E" }}>({productoEncontrado.stock_available} disponibles)</span></p>
            <div className="flex gap-2">
              <input type="number" min={1} max={productoEncontrado.stock_available} autoFocus value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, Math.min(productoEncontrado.stock_available, Number(e.target.value) || 1)))}
                className="w-24 px-2 py-3 rounded text-lg text-center outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
              <button type="submit" disabled={enviando || productoEncontrado.stock_available < 1} className="flex-1 rounded flex items-center justify-center gap-1.5 text-sm font-medium" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                <Plus size={16} /> {enviando ? "Asignando..." : "Asignar (Enter)"}
              </button>
              <button type="button" onClick={cancelarBusqueda} className="px-4 rounded text-sm" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>Cancelar</button>
            </div>
            {productoEncontrado.stock_available < 1 && <p className="text-xs mt-2" style={{ color: "#7A2540" }}>Sin stock disponible.</p>}
          </form>
        )}

        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {grupos.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Los productos asignados hoy aparecerán aquí, agrupados por código. Selecciona una fila y presiona Supr para quitarla.</p>}
          {grupos.map((g, i) => (
            <div key={g.product_id} onClick={() => setFilaSeleccionada(g.product_id)}
              className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer"
              style={{ borderBottom: i < grupos.length - 1 ? "1px solid #D9D0C2" : "none", background: filaSeleccionada === g.product_id ? "#EDE7DE" : "transparent" }}>
              <div>
                <p className="text-sm">{g.codigo} · {g.nombre} × {g.cantidadTotal}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>{g.detalle.map((d) => `${d.cantidad} un. — ${d.fecha}`).join(" · ")}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-serif text-sm">Bs {g.subtotalConDescuento.toFixed(2)}</span>
                <button onClick={(e) => { e.stopPropagation(); disminuirUnidad(g.detalle[g.detalle.length - 1].id); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} title="Quitar 1 unidad">
                  <Minus size={13} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); aumentarUnidad(g.product_id); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#9C7A3C", color: "#F7F3EC" }} title="Agregar 1 unidad">
                  <Plus size={13} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); quitarProductoCompleto(g); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#F4E3E6", color: "#7A2540" }} title="Quitar producto completo (Supr)">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Resumen de hoy para este cliente</p>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Unidades</span><span>{unidades}</span></div>
        <div className="flex justify-between text-sm pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>Total (con descuento)</span><span className="font-serif">Bs {total.toFixed(2)}</span></div>
      </div>
    </div>
  );
}
