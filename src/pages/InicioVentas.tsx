import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, Trash2, Search, ScanBarcode, UserPlus, ShoppingCart, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSellerSession } from "../hooks/useSellerSession";
import type { Customer, Product, Category } from "../lib/types";
import { precioNegocioPorCantidad } from "../lib/pricing";

interface LineaCarrito {
  product: Product;
  cantidad: number;
}

// Pantalla inicial: escanear/buscar productos a una lista temporal (nada se
// descuenta todavía), y recién al presionar "Asignar cliente" (eligiendo un
// cliente existente, creando uno nuevo, o como venta directa sin cliente) se
// realiza la asignación real contra Supabase, de una sola vez.
export default function InicioVentas() {
  const { vendedorActivoId, vendedorActivoNombre, sesionActivaId } = useSellerSession();
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [filaSeleccionada, setFilaSeleccionada] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [mostrarAsignar, setMostrarAsignar] = useState(false);
  const [modo, setModo] = useState<"cliente" | "nuevo" | "directa">("cliente");
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [clienteElegido, setClienteElegido] = useState<Customer | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [procesando, setProcesando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Category[]>([]);

  useEffect(() => {
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => setClientes((data as Customer[]) ?? []));
    supabase.from("categories").select("*").order("sort_order").then(({ data }) => setCategorias((data as Category[]) ?? []));
  }, []);

  async function buscarYAgregar(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim() || buscando) return;
    setBuscando(true);
    setNoEncontrado(false);
    const { data: producto } = await supabase.from("products").select("*").eq("code", codigo.trim()).is("deleted_at", null).maybeSingle();
    setBuscando(false);
    if (!producto) {
      setNoEncontrado(true);
      return;
    }
    const p = producto as Product;
    if (p.stock_available < 1) {
      alert("Ese producto no tiene stock disponible.");
      setCodigo("");
      return;
    }
    setCarrito((prev) => {
      const existente = prev.find((l) => l.product.id === p.id);
      if (existente) {
        if (existente.cantidad >= p.stock_available) return prev;
        return prev.map((l) => (l.product.id === p.id ? { ...l, cantidad: l.cantidad + 1 } : l));
      }
      return [...prev, { product: p, cantidad: 1 }];
    });
    setFilaSeleccionada(p.id);
    setCodigo("");
    inputRef.current?.focus();
  }

  function cambiarCantidad(productId: string, delta: number) {
    setCarrito((prev) =>
      prev
        .map((l) => (l.product.id === productId ? { ...l, cantidad: Math.max(0, Math.min(l.product.stock_available, l.cantidad + delta)) } : l))
        .filter((l) => l.cantidad > 0)
    );
  }

  function quitarLinea(productId: string) {
    setCarrito((prev) => prev.filter((l) => l.product.id !== productId));
    setFilaSeleccionada(null);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && filaSeleccionada) {
        const activo = document.activeElement;
        const enCampoDeTexto = activo && (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA" || activo.tagName === "SELECT");
        if (enCampoDeTexto) return;
        e.preventDefault();
        quitarLinea(filaSeleccionada);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filaSeleccionada]);

  useEffect(() => {
    function confirmarConEnter(e: KeyboardEvent) {
      if (e.key !== "Enter" || !mostrarAsignar || procesando || carrito.length === 0) return;
      const el = e.target as HTMLElement | null;
      // Los campos del formulario conservan Enter para confirmar, pero evitamos
      // interferir con botones/selects y con el buscador mientras aún no hay cliente elegido.
      if (el?.tagName === "BUTTON" || el?.tagName === "SELECT" || el?.tagName === "TEXTAREA") return;
      if (modo === "cliente" && !clienteElegido) return;
      if (modo === "nuevo" && (!nuevoNombre.trim() || !nuevoTelefono.trim())) return;
      e.preventDefault();
      confirmarAsignacion();
    }
    window.addEventListener("keydown", confirmarConEnter);
    return () => window.removeEventListener("keydown", confirmarConEnter);
  }, [mostrarAsignar, procesando, carrito, modo, clienteElegido, nuevoNombre, nuevoTelefono]);

  function precioPreview(l: LineaCarrito) {
    const categoria = categorias.find((c) => c.id === l.product.category_id)?.name ?? null;
    return precioNegocioPorCantidad(categoria, l.product.name, l.cantidad, Number(l.product.price), l.product.description);
  }
  const total = carrito.reduce((a, l) => a + precioPreview(l) * l.cantidad, 0);
  const unidades = carrito.reduce((a, l) => a + l.cantidad, 0);

  const coincidenciasCliente = useMemo(() => {
    const q = busquedaCliente.trim().toLowerCase();
    if (!q) return clientes.slice(0, 8);
    return clientes.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 8);
  }, [busquedaCliente, clientes]);

  async function obtenerOrdenAbierta(customerId: string) {
    const { data: existente } = await supabase
      .from("orders").select("id").eq("customer_id", customerId).in("status", ["open", "reopened"]).maybeSingle();
    if (existente) return existente.id as string;
    const { data: nueva } = await supabase.from("orders").insert({ customer_id: customerId }).select().single();
    return nueva!.id as string;
  }

  // Único momento en que se escribe de verdad en Supabase (con protección
  // contra doble ejecución vía "procesando").
  async function confirmarAsignacion(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (procesando || carrito.length === 0) return;

    if (modo === "cliente" && !clienteElegido) { alert("Elige un cliente de la lista."); return; }
    if (modo === "nuevo" && (!nuevoNombre.trim() || !nuevoTelefono.trim())) { alert("Completa nombre y teléfono del cliente nuevo."); return; }

    setProcesando(true);
    try {
      // Validar stock de TODAS las líneas antes de escribir nada, para no
      // dejar una asignación a medias si algo cambió justo antes de confirmar.
      const ids = carrito.map((l) => l.product.id);
      const { data: stockActual, error: errStock } = await supabase.from("products").select("id, code, stock_available").in("id", ids);
      if (errStock) throw new Error(errStock.message);
      for (const l of carrito) {
        const actual = stockActual?.find((p: any) => p.id === l.product.id);
        if (!actual || actual.stock_available < l.cantidad) {
          throw new Error(`Ya no hay stock suficiente de ${l.product.code} (disponible: ${actual?.stock_available ?? 0}, pedido: ${l.cantidad}). No se asignó nada.`);
        }
      }

      let customerId: string | null = null;
      let nombreDestino = "Venta directa";

      if (modo === "cliente" && clienteElegido) {
        customerId = clienteElegido.id;
        nombreDestino = clienteElegido.name;
      } else if (modo === "nuevo") {
        const { data: creado, error } = await supabase.from("customers").insert({ name: nuevoNombre.trim(), phone: nuevoTelefono.trim() }).select().single();
        if (error || !creado) throw new Error(error?.message ?? "No se pudo crear el cliente");
        customerId = creado.id;
        nombreDestino = creado.name;
      }

      if (modo === "directa") {
        const { data: orden, error } = await supabase.from("orders").insert({ customer_id: null, direct_sale: true }).select().single();
        if (error || !orden) throw new Error(error?.message ?? "No se pudo iniciar la venta directa");
        for (const l of carrito) {
          const { error: errAsig } = await supabase.rpc("assign_product_to_order", {
            p_order_id: orden.id, p_product_id: l.product.id, p_quantity: l.cantidad, p_origin: "manual",
            p_seller_id: vendedorActivoId, p_session_id: sesionActivaId,
          });
          if (errAsig) throw new Error(errAsig.message);
        }
        const { data: totalReal, error: errCalc } = await supabase.rpc("calcular_total_pedido", { p_order_id: orden.id });
        if (errCalc) throw new Error(errCalc.message);
        if ((totalReal ?? 0) > 0) {
          await supabase.from("payments").insert({ customer_id: null, order_id: orden.id, amount: totalReal, method: metodoPago });
        }
        const { error: errCierre } = await supabase.rpc("close_order", { p_order_id: orden.id });
        if (errCierre) throw new Error(errCierre.message);
        setUltimoResultado(`Venta directa finalizada — Total Bs ${(totalReal ?? 0).toFixed(2)}`);
      } else if (customerId) {
        const orderId = await obtenerOrdenAbierta(customerId);
        for (const l of carrito) {
          const { error: errAsig } = await supabase.rpc("assign_product_to_order", {
            p_order_id: orderId, p_product_id: l.product.id, p_quantity: l.cantidad, p_origin: "manual",
            p_seller_id: vendedorActivoId, p_session_id: sesionActivaId,
          });
          if (errAsig) throw new Error(errAsig.message);
        }
        setUltimoResultado(`Asignado a ${nombreDestino}: ${unidades} unidad(es) — Bs ${total.toFixed(2)}. El pedido sigue abierto hasta que se cierre desde Clientes.`);
      }

      setCarrito([]);
      setMostrarAsignar(false);
      setClienteElegido(null);
      setBusquedaCliente("");
      setNuevoNombre("");
      setNuevoTelefono("");
      setModo("cliente");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="font-serif text-lg flex items-center gap-2"><ShoppingCart size={18} /> Asignación rápida / Venta directa</p>
          <span className="text-xs" style={{ color: "#5B4E5E" }}>
            {vendedorActivoNombre ? `Vendedor: ${vendedorActivoNombre}` : "Sin vendedor activo"}
          </span>
        </div>

        {ultimoResultado && (
          <div className="p-3 mb-3 rounded-md" style={{ background: "#E4EBE1", border: "1px solid #4F6F52" }}>
            <p className="text-xs" style={{ color: "#4F6F52" }}>{ultimoResultado}</p>
          </div>
        )}

        <form onSubmit={buscarYAgregar} className="p-4 rounded-md mb-3 ls-code-search">
          <p className="text-xs mb-2 flex items-center gap-1.5" className="ls-code-search-label"><ScanBarcode size={14} /> Escanear o escribir código — Enter agrega a la lista</p>
          <div className="flex gap-2">
            <input ref={inputRef} autoFocus value={codigo} onChange={(e) => { setCodigo(e.target.value); setNoEncontrado(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="80-50"
              className="flex-1 px-3 py-3 rounded text-lg outline-none" style={{ background: "#F7F3EC", color: "#2B1E2E" }} />
            <button type="submit" disabled={buscando} className="px-5 rounded flex items-center gap-1.5 ls-code-search-button">
              <Plus size={16} /> Agregar
            </button>
          </div>
          {noEncontrado && (
            <div className="mt-3 p-3 rounded" style={{ background: "#F4E3E6" }}>
              <p className="text-xs" style={{ color: "#7A2540" }}>No se encontró ningún producto con ese código.</p>
            </div>
          )}
        </form>

        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {carrito.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Escanea o escribe un código para empezar. Selecciona una fila y presiona Supr para quitarla.</p>}
          {carrito.map((l, i) => (
            <div key={l.product.id} onClick={() => setFilaSeleccionada(l.product.id)}
              className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer"
              style={{ borderBottom: i < carrito.length - 1 ? "1px solid #D9D0C2" : "none", background: filaSeleccionada === l.product.id ? "#EDE7DE" : "transparent" }}>
              <div>
                <p className="text-sm">{l.product.code} · {l.product.name} × {l.cantidad}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>Bs {precioPreview(l).toFixed(2)} c/u{precioPreview(l) < Number(l.product.price) ? ` (− Bs ${(Number(l.product.price) - precioPreview(l)).toFixed(2)} c/u)` : ""} · {l.product.stock_available} disponibles</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-serif text-sm">Bs {(precioPreview(l) * l.cantidad).toFixed(2)}</span>
                <button onClick={(e) => { e.stopPropagation(); cambiarCantidad(l.product.id, -1); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                  <Minus size={13} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); cambiarCantidad(l.product.id, 1); }} disabled={l.cantidad >= l.product.stock_available} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                  <Plus size={13} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); quitarLinea(l.product.id); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#F4E3E6", color: "#7A2540" }} title="Quitar (Supr)">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Resumen</p>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Unidades</span><span>{unidades}</span></div>
        <div className="flex justify-between text-sm mb-3 pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>Total</span><span className="font-serif">Bs {total.toFixed(2)}</span></div>
        <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>El descuento por cantidad acumulada se calcula al asignarlo al pedido del cliente (o al cerrar la venta directa).</p>

        {!mostrarAsignar ? (
          <button onClick={() => setMostrarAsignar(true)} disabled={carrito.length === 0} className="w-full py-2.5 rounded-md text-sm flex items-center justify-center gap-2"
            style={{ background: carrito.length > 0 ? "#2B1E2E" : "#D9D0C2", color: "#F7F3EC" }}>
            <Users size={15} /> Asignar cliente
          </button>
        ) : (
          <form onSubmit={confirmarAsignacion} className="p-3 rounded-md" style={{ background: "#EDE7DE" }}>
            <div className="flex gap-1.5 mb-2">
              <button type="button" onClick={() => setModo("cliente")} className="flex-1 text-xs px-2 py-1.5 rounded-md" style={{ background: modo === "cliente" ? "#9C7A3C" : "#F7F3EC", color: modo === "cliente" ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>Cliente</button>
              <button type="button" onClick={() => setModo("nuevo")} className="flex-1 text-xs px-2 py-1.5 rounded-md" style={{ background: modo === "nuevo" ? "#9C7A3C" : "#F7F3EC", color: modo === "nuevo" ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>Nuevo</button>
              <button type="button" onClick={() => setModo("directa")} className="flex-1 text-xs px-2 py-1.5 rounded-md" style={{ background: modo === "directa" ? "#9C7A3C" : "#F7F3EC", color: modo === "directa" ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>Directa</button>
            </div>

            {modo === "cliente" && (
              <div className="mb-2">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded mb-1" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                  <Search size={13} style={{ color: "#5B4E5E" }} />
                  <input value={clienteElegido ? clienteElegido.name : busquedaCliente} onChange={(e) => { setBusquedaCliente(e.target.value); setClienteElegido(null); }}
                    placeholder="Buscar cliente…" className="flex-1 text-sm outline-none bg-transparent" />
                </div>
                {!clienteElegido && (
                  <div className="max-h-32 overflow-y-auto rounded" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                    {coincidenciasCliente.map((c) => (
                      <button key={c.id} type="button" onClick={() => setClienteElegido(c)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-black/5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                        {c.name} <span style={{ color: "#5B4E5E" }}>({c.phone})</span>
                      </button>
                    ))}
                    {coincidenciasCliente.length === 0 && <p className="text-xs p-2" style={{ color: "#5B4E5E" }}>Sin resultados.</p>}
                  </div>
                )}
              </div>
            )}

            {modo === "nuevo" && (
              <div className="mb-2 flex flex-col gap-1.5">
                <p className="text-xs flex items-center gap-1" style={{ color: "#5B4E5E" }}><UserPlus size={12} /> Cliente nuevo</p>
                <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nombre" className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                <input value={nuevoTelefono} onChange={(e) => setNuevoTelefono(e.target.value)} placeholder="Teléfono / WhatsApp" className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
              </div>
            )}

            {modo === "directa" && (
              <div className="mb-2">
                <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Método de pago (venta directa, se cierra de inmediato)</p>
                <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="qr">QR</option>
                </select>
              </div>
            )}

            <div className="flex gap-2">
              <button type="submit" disabled={procesando} className="flex-1 text-xs py-2 rounded-md" style={{ background: "#2B1E2E", color: "#F7F3EC" }}>
                {procesando ? "Procesando..." : "Confirmar (Enter)"}
              </button>
              <button type="button" onClick={() => setMostrarAsignar(false)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
