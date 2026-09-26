import React, { useEffect, useMemo, useState } from "react";
import { Share2, Search, Plus, Minus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSellerSession } from "../hooks/useSellerSession";
import type { Customer, Product, Category } from "../lib/types";
import { loadPricingRules, precioNegocioPorCantidad, type PricingRule } from "../lib/pricing";

interface Preparacion {
  product: Product;
  cantidades: Record<string, number>; // clienteId -> cantidad
}

// Preasignación: cada producto que se prepara (con sus cantidades por
// cliente) se agrega a una lista temporal, en memoria del navegador. Nada
// se escribe en Supabase ni se descuenta stock hasta pulsar
// "Confirmar todas las asignaciones".
export default function AsignacionMultiple() {
  const { vendedorActivoId, sesionActivaId } = useSellerSession();
  const [productos, setProductos] = useState<Product[]>([]);
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [productoId, setProductoId] = useState("");
  const [mostrarLista, setMostrarLista] = useState(false);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [preparaciones, setPreparaciones] = useState<Preparacion[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [preparacionSeleccionada, setPreparacionSeleccionada] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Category[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [cantidadesExistentes, setCantidadesExistentes] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    cargarProductos();
    loadPricingRules().then(setReglas);
    supabase.from("categories").select("*").order("sort_order").then(({ data }) => setCategorias((data as Category[]) ?? []));
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => {
      setClientes((data as Customer[]) ?? []);
    });
  }, []);

  async function cargarProductos() {
    const { data } = await supabase.from("products").select("*").is("deleted_at", null).gt("stock_available", 0).order("name");
    setProductos((data as Product[]) ?? []);
  }

  const producto = productos.find((p) => p.id === productoId);
  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return productos.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [busqueda, productos, preparaciones]);
const clientesFiltrados = useMemo(() => {
  const q = busquedaCliente.trim().toLowerCase();

  if (!q) return clientes;

  return clientes.filter((c) =>
    c.name?.toLowerCase().includes(q) ||
    c.phone?.toLowerCase().includes(q)
  );
}, [clientes, busquedaCliente]);
  let totalPreparadoAhora = 0;
  for (const key in cantidades) totalPreparadoAhora += Number(cantidades[key]) || 0;
  const restanteAhora = (producto?.stock_available ?? 0) - totalPreparadoAhora;

  async function elegirProducto(p: Product) {
    setProductoId(p.id);
    setBusqueda(`${p.code} · ${p.name}`);
    setMostrarLista(false);
    const ya = preparaciones.find((x) => x.product.id === p.id);
    setCantidades(ya ? { ...ya.cantidades } : {});
    setPreparacionSeleccionada(ya ? p.id : null);

    // Cantidad del mismo producto que cada cliente ya tiene en su pedido abierto.
    const { data: ordenes } = await supabase.from("orders").select("id, customer_id").in("status", ["open", "reopened"]);
    const ids = (ordenes ?? []).map((o: any) => o.id);
    const mapa: Record<string, number> = {};
    if (ids.length) {
      const { data: lineas } = await supabase.from("order_items").select("order_id, quantity").in("order_id", ids).eq("product_id", p.id);
      for (const l of lineas ?? []) {
        const o: any = (ordenes ?? []).find((x: any) => x.id === (l as any).order_id);
        if (o?.customer_id) mapa[o.customer_id] = (mapa[o.customer_id] ?? 0) + Number((l as any).quantity ?? 0);
      }
    }
    setCantidadesExistentes((prev) => ({ ...prev, [p.id]: mapa }));
  }

  // Agrega el producto actual (con sus cantidades) a la lista temporal de
  // preasignación. Todavía no toca Supabase.
  function agregarALaLista() {
    if (!producto || totalPreparadoAhora === 0 || restanteAhora < 0) return;
    const cants: Record<string, number> = {};
    Object.entries(cantidades).forEach(([id, c]) => { if (Number(c) > 0) cants[id] = Number(c); });
    setPreparaciones((prev) => {
      const idx = prev.findIndex((x) => x.product.id === producto.id);
      if (idx < 0) return [...prev, { product: producto, cantidades: cants }];
      const copia = [...prev];
      copia[idx] = { product: producto, cantidades: cants };
      return copia;
    });
    setBusqueda("");
    setProductoId("");
    setCantidades({});
    setPreparacionSeleccionada(null);
  }

  function quitarPreparacion(productId: string) {
    setPreparaciones((prev) => prev.filter((p) => p.product.id !== productId));
  }

  function ajustarPreparacion(productId: string, clienteId: string, delta: number) {
    setPreparaciones((prev) => prev.map((p) => {
      if (p.product.id !== productId) return p;
      const actual = Number(p.cantidades[clienteId] ?? 0);
      const siguiente = Math.max(0, actual + delta);
      const c = { ...p.cantidades, [clienteId]: siguiente };
      if (siguiente === 0) delete c[clienteId];
      return { ...p, cantidades: c };
    }));
  }

  function descuentoPreview(prep: Preparacion, clienteId: string) {
    const nueva = Number(prep.cantidades[clienteId] ?? 0);
    const acumulada = Number(cantidadesExistentes[prep.product.id]?.[clienteId] ?? 0) + nueva;
    const categoria = categorias.find((c) => c.id === prep.product.category_id)?.name ?? null;
    const final = precioNegocioPorCantidad(categoria, prep.product.name, acumulada, Number(prep.product.price), prep.product.description);
    return { acumulada, descuento: Math.max(0, Number(prep.product.price) - final), final };
  }

  useEffect(() => {
    function teclado(e: KeyboardEvent) {
      const activo = document.activeElement as HTMLElement | null;
      const escribiendo = activo && (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA" || activo.tagName === "SELECT");
      if ((e.key === "Delete" || e.key === "Backspace") && !escribiendo && preparacionSeleccionada) {
        e.preventDefault(); quitarPreparacion(preparacionSeleccionada); setPreparacionSeleccionada(null);
      }
      if (e.key === "Enter" && !escribiendo && preparaciones.length > 0) {
        e.preventDefault(); confirmarTodo();
      }
    }
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [preparacionSeleccionada, preparaciones, confirmando]);

  const totalGeneral = preparaciones.reduce((a, p) => a + Object.values(p.cantidades).reduce((x, y) => x + y, 0), 0);

  // Único momento en que se escribe de verdad: valida stock de TODO lo
  // preparado primero, y solo si todo alcanza empieza a asignar.
  async function confirmarTodo() {
    if (confirmando || preparaciones.length === 0) return;
    setConfirmando(true);
    try {
      const ids = preparaciones.map((p) => p.product.id);
      const { data: stockActual, error: errStock } = await supabase.from("products").select("id, code, stock_available").in("id", ids);
      if (errStock) throw new Error(errStock.message);
      for (const prep of preparaciones) {
        const totalPedido = Object.values(prep.cantidades).reduce((a, b) => a + b, 0);
        const actual = stockActual?.find((p: any) => p.id === prep.product.id);
        if (!actual || actual.stock_available < totalPedido) {
          throw new Error(`Ya no hay stock suficiente de ${prep.product.code} (disponible: ${actual?.stock_available ?? 0}, preparado: ${totalPedido}). No se asignó nada.`);
        }
      }

      for (const prep of preparaciones) {
        for (const [clienteId, cantidad] of Object.entries(prep.cantidades)) {
          if (cantidad <= 0) continue;
          const { data: existente } = await supabase
            .from("orders").select("id").eq("customer_id", clienteId).in("status", ["open", "reopened"]).maybeSingle();
          const orderId = existente ? existente.id : (await supabase.from("orders").insert({ customer_id: clienteId }).select().single()).data!.id;
          const { error: errAsig } = await supabase.rpc("assign_product_to_order", {
            p_order_id: orderId, p_product_id: prep.product.id, p_quantity: cantidad, p_origin: "manual",
            p_seller_id: vendedorActivoId, p_session_id: sesionActivaId,
          });
          if (errAsig) throw new Error(errAsig.message);
        }
      }

      setPreparaciones([]);
      await cargarProductos();
      alert("Todas las asignaciones se confirmaron correctamente.");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setConfirmando(false);
    }
  }

  function nombreCliente(id: string) {
    return clientes.find((c) => c.id === id)?.name ?? "Cliente";
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <p className="font-serif text-lg mb-1">Asignar a varios clientes</p>
        <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>Prepara uno o más productos con sus cantidades por cliente. Nada se asigna hasta confirmar todo al final.</p>

        <form onSubmit={(e) => { e.preventDefault(); agregarALaLista(); }} className="p-4 mb-3 relative" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-1.5" style={{ color: "#5B4E5E" }}>Buscar producto por código o descripción</p>
          <div className="flex items-center gap-2 px-3 py-2 rounded mb-2" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            <Search size={14} style={{ color: "#5B4E5E" }} />
            <input
              value={busqueda}
              onChange={(e) => { setBusqueda(e.target.value); setMostrarLista(true); setProductoId(""); }}
              onFocus={() => setMostrarLista(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !producto && coincidencias.length > 0) {
                  e.preventDefault();
                  elegirProducto(coincidencias[0]);
                }
              }}
              placeholder="Ej: 8169 o Anillo…"
              className="flex-1 text-sm outline-none bg-transparent"
            />
          </div>
          {mostrarLista && coincidencias.length > 0 && (
            <div className="mb-2 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
              {coincidencias.map((p) => (
                <button key={p.id} type="button" onClick={() => elegirProducto(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                  {p.code} · {p.name} <span style={{ color: "#5B4E5E" }}>({p.stock_available} disp.)</span>
                </button>
              ))}
            </div>
          )}

          {producto && (
            <>
              <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
  <Search size={16} style={{ color: "#5B4E5E" }} />
  <input
    type="text"
    value={busquedaCliente}
    onChange={(e) => setBusquedaCliente(e.target.value)}
    placeholder="Buscar cliente por nombre o teléfono..."
    className="flex-1 bg-transparent outline-none text-sm"
  />
</div>
              <div style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} className="rounded mb-2 max-h-56 overflow-y-auto">
                <div className="grid grid-cols-3 px-3 py-1.5 text-xs" style={{ color: "#5B4E5E", borderBottom: "1px solid #D9D0C2" }}>
                  <span>Cliente</span><span>Teléfono</span><span>Cantidad</span>
                </div>
                {clientesFiltrados.map((c, i) => (
                  <div key={c.id} className="grid grid-cols-3 px-3 py-1.5 items-center" style={{ borderBottom: i < clientesFiltrados.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                    <span className="text-xs">{c.name}</span>
                    <span className="text-xs" style={{ color: "#5B4E5E" }}>{c.phone}</span>
                    <input type="number" min={0} value={cantidades[c.id] ?? 0} onChange={(e) => setCantidades({ ...cantidades, [c.id]: Number(e.target.value) })}
                      className="w-16 px-2 py-1 rounded text-xs outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs mb-2" style={{ color: restanteAhora < 0 ? "#7A2540" : "#5B4E5E" }}>
                <span>Disponible: {producto.stock_available} · Preparado: {totalPreparadoAhora}</span>
                <span>Restante: {restanteAhora}</span>
              </div>
              <button type="submit" disabled={totalPreparadoAhora === 0 || restanteAhora < 0} className="w-full py-2 rounded-md text-sm flex items-center justify-center gap-1.5"
                style={{ background: totalPreparadoAhora > 0 && restanteAhora >= 0 ? "#4F6F52" : "#D9D0C2", color: "#F7F3EC" }}>
                <Plus size={14} /> Agregar a la lista (Enter)
              </button>
            </>
          )}
        </form>

        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {preparaciones.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Todavía no preparaste ningún producto.</p>}
          {preparaciones.map((prep, i) => (
            <div key={prep.product.id} onClick={() => setPreparacionSeleccionada(prep.product.id)} className="px-3.5 py-2.5 cursor-pointer"
              style={{ borderBottom: i < preparaciones.length - 1 ? "1px solid #D9D0C2" : "none", outline: preparacionSeleccionada === prep.product.id ? "2px solid #A9873D" : "none" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm">{prep.product.code} · {prep.product.name}</p>
                <button onClick={(e) => { e.stopPropagation(); quitarPreparacion(prep.product.id); }} className="p-1 rounded" style={{ color: "#7A2540" }} title="Quitar de la lista">
                  <Trash2 size={14} />
                </button>
              </div>
              {Object.entries(prep.cantidades).map(([id, c]) => {
                const pr = descuentoPreview(prep, id);
                return (
                  <div key={id} className="flex items-center justify-between gap-2 py-1 text-xs">
                    <span>{nombreCliente(id)}: {c} un. · Bs {pr.final.toFixed(2)} c/u {pr.descuento > 0 ? `(− Bs ${pr.descuento.toFixed(2)} c/u; acum. ${pr.acumulada})` : ""}</span>
                    <span className="flex items-center gap-1">
                      <button type="button" onClick={(e) => { e.stopPropagation(); ajustarPreparacion(prep.product.id, id, -1); }} className="p-1 rounded" style={{ background: "#EDE7DE" }}><Minus size={12}/></button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); ajustarPreparacion(prep.product.id, id, 1); }} className="p-1 rounded" style={{ background: "#EDE7DE" }}><Plus size={12}/></button>
                    </span>
                  </div>
                );
              })}
              <button type="button" onClick={() => elegirProducto(prep.product)} className="text-xs mt-1 underline" style={{ color: "#5B4E5E" }}>Editar cantidades por cliente</button>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Resumen de la preasignación</p>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Productos preparados</span><span>{preparaciones.length}</span></div>
        <div className="flex justify-between text-sm pt-1.5 mb-3" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>Unidades totales</span><span className="font-serif">{totalGeneral}</span></div>
        <button onClick={confirmarTodo} disabled={preparaciones.length === 0 || confirmando}
          className="w-full py-2.5 rounded-md text-sm flex items-center justify-center gap-2"
          style={{ background: preparaciones.length > 0 ? "#2B1E2E" : "#D9D0C2", color: "#F7F3EC" }}>
          <Share2 size={15} /> {confirmando ? "Asignando..." : "Confirmar todas las asignaciones"}
        </button>
      </div>
    </div>
  );
}
