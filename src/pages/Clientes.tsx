import React, { useEffect, useMemo, useState } from "react";
import { Plus, Minus, MessageCircle, Printer, AlertTriangle, UserX, Pencil, Trash2, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import { loadPricingRules, precioUnitario, PricingRule } from "../lib/pricing";
import type { Customer } from "../lib/types";

interface ItemDetalle {
  id: string;
  product_id: string;
  codigo: string;
  nombre: string;
  categoria_id: string | null;
  categoria: string;
  cantidad: number;
  precio_base: number;
  fecha: string;
}

interface DepositoDetalle {
  id: string;
  amount: number;
  method: string;
  paid_at: string;
}

export default function Clientes() {
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [seleccionado, setSeleccionado] = useState<Customer | null>(null);
  const [ordenId, setOrdenId] = useState<string | null>(null);
  const [fechaApertura, setFechaApertura] = useState<string | null>(null);
  const [items, setItems] = useState<ItemDetalle[]>([]);
  const [depositos, setDepositos] = useState<DepositoDetalle[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [nombreNegocio, setNombreNegocio] = useState("Loves Stories");
  const [verRecibo, setVerRecibo] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [inactivos, setInactivos] = useState<{ name: string; phone: string; ultima: string | null }[]>([]);
  const [editando, setEditando] = useState(false);
  const [edicion, setEdicion] = useState({ name: "", phone: "", notes: "" });
  const [mostrarDeposito, setMostrarDeposito] = useState(false);
  const [montoDeposito, setMontoDeposito] = useState(0);
  const [metodoDeposito, setMetodoDeposito] = useState("efectivo");

  useEffect(() => {
    cargarClientes();
    loadPricingRules().then(setReglas);
    supabase.from("app_settings").select("business_name").eq("id", 1).single().then(({ data }) => {
      if (data?.business_name) setNombreNegocio(data.business_name);
    });
    cargarInactivos();
  }, []);

  useEffect(() => {
    if (seleccionado) {
      cargarPedido(seleccionado.id);
      setEdicion({ name: seleccionado.name, phone: seleccionado.phone, notes: seleccionado.notes ?? "" });
      setEditando(false);
      setMostrarDeposito(false);
    }
  }, [seleccionado]);

  async function cargarClientes() {
    const { data } = await supabase.from("customers").select("*").is("deleted_at", null).order("name");
    setClientes((data as Customer[]) ?? []);
    if (data && data.length > 0) setSeleccionado(data[0] as Customer);
    else setSeleccionado(null);
  }

  async function cargarInactivos() {
    const limite = new Date();
    limite.setDate(limite.getDate() - 60);
    const { data } = await supabase
      .from("customers")
      .select("name, phone, payments(paid_at)")
      .is("deleted_at", null);
    const lista = (data ?? [])
      .map((c: any) => {
        const fechas = (c.payments ?? []).map((p: any) => p.paid_at).sort();
        const ultima = fechas.length ? fechas[fechas.length - 1] : null;
        return { name: c.name, phone: c.phone, ultima };
      })
      .filter((c: any) => !c.ultima || new Date(c.ultima) < limite)
      .slice(0, 5);
    setInactivos(lista);
  }

  async function cargarPedido(customerId: string) {
    const { data: orden } = await supabase
      .from("orders")
      .select("id, opened_at")
      .eq("customer_id", customerId)
      .in("status", ["open", "reopened"])
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!orden) {
      setOrdenId(null);
      setFechaApertura(null);
      setItems([]);
    } else {
      setOrdenId(orden.id);
      setFechaApertura(orden.opened_at);
      const { data: filas } = await supabase
        .from("order_items")
        .select("id, product_id, quantity, unit_price, assigned_at, products(code, name, category_id, categories(name))")
        .eq("order_id", orden.id);
      const detalle: ItemDetalle[] = (filas ?? []).map((f: any) => ({
        id: f.id,
        product_id: f.product_id,
        codigo: f.products?.code ?? "",
        nombre: f.products?.name ?? "",
        categoria_id: f.products?.category_id ?? null,
        categoria: f.products?.categories?.name ?? "Otros",
        cantidad: f.quantity,
        precio_base: f.unit_price,
        fecha: new Date(f.assigned_at).toLocaleString("es-BO"),
      }));
      setItems(detalle);
    }

    const { data: pagos } = await supabase.from("payments").select("id, amount, method, paid_at").eq("customer_id", customerId).order("paid_at", { ascending: false });
    setDepositos((pagos as DepositoDetalle[]) ?? []);
  }

  const porCategoria = useMemo(() => {
    const grupos: Record<string, ItemDetalle[]> = {};
    items.forEach((it) => {
      grupos[it.categoria] = grupos[it.categoria] || [];
      grupos[it.categoria].push(it);
    });
    return grupos;
  }, [items]);

  const total = items.reduce((acc, it) => acc + precioUnitario(reglas, it.categoria_id, it.cantidad, it.precio_base) * it.cantidad, 0);
  const subtotalSinDescuento = items.reduce((acc, it) => acc + it.precio_base * it.cantidad, 0);
  const descuentoTotal = subtotalSinDescuento - total;
  const depositado = depositos.reduce((a, d) => a + d.amount, 0);
  const saldo = total - depositado;

  async function quitarUnidad(itemId: string) {
    await supabase.rpc("remove_order_item_unit", { p_order_item_id: itemId, p_quantity: 1 });
    if (seleccionado) cargarPedido(seleccionado.id);
  }

  async function cerrarPedido() {
    if (!ordenId) return;
    await supabase.rpc("close_order", { p_order_id: ordenId });
    if (seleccionado) cargarPedido(seleccionado.id);
    setVerRecibo(true);
  }

  async function crearCliente(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevoNombre || !nuevoTelefono) return;
    const { data } = await supabase.from("customers").insert({ name: nuevoNombre, phone: nuevoTelefono }).select().single();
    setMostrarNuevo(false);
    setNuevoNombre("");
    setNuevoTelefono("");
    await cargarClientes();
    if (data) setSeleccionado(data as Customer);
  }

  async function guardarEdicion() {
    if (!seleccionado) return;
    await supabase.from("customers").update({ name: edicion.name, phone: edicion.phone, notes: edicion.notes || null }).eq("id", seleccionado.id);
    setEditando(false);
    await cargarClientes();
  }

  async function eliminarCliente() {
    if (!seleccionado) return;
    if (!confirm(`¿Eliminar a "${seleccionado.name}"? Podrás restaurarlo luego desde la Papelera.`)) return;
    await supabase.from("customers").update({ deleted_at: new Date().toISOString() }).eq("id", seleccionado.id);
    await cargarClientes();
  }

  async function registrarDeposito() {
    if (!seleccionado || montoDeposito <= 0) return;
    await supabase.from("payments").insert({
      customer_id: seleccionado.id,
      order_id: ordenId,
      amount: montoDeposito,
      method: metodoDeposito,
    });
    setMontoDeposito(0);
    setMostrarDeposito(false);
    await cargarPedido(seleccionado.id);
    await cargarInactivos();
  }

  function linkWhatsapp(telefono: string, mensaje: string) {
    const limpio = telefono.replace(/\D/g, "");
    return `https://wa.me/${limpio}?text=${encodeURIComponent(mensaje)}`;
  }

  function mensajeResumen() {
    if (!seleccionado) return "";
    const lineas = items.map((it) => `${it.codigo} x${it.cantidad} = Bs ${precioUnitario(reglas, it.categoria_id, it.cantidad, it.precio_base) * it.cantidad}`);
    return `Hola ${seleccionado.name}. Te envío el detalle de tu pedido en ${nombreNegocio}:\n\n${lineas.join("\n")}\n\nTotal: Bs ${total}\nDepósitos: Bs ${depositado}\nSaldo: Bs ${saldo}`;
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <div className="flex items-center justify-between mb-3">
          <p className="font-serif text-lg">Clientes</p>
          <button onClick={() => setMostrarNuevo((v) => !v)} className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
            <Plus size={13} /> Nuevo
          </button>
        </div>

        {mostrarNuevo && (
          <form onSubmit={crearCliente} className="p-3 mb-3 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nombre" required
              className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
            <input value={nuevoTelefono} onChange={(e) => setNuevoTelefono(e.target.value)} placeholder="Teléfono / WhatsApp" required
              className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
            <button type="submit" className="text-xs px-3 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Guardar cliente</button>
          </form>
        )}

        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {clientes.map((c, i) => (
            <button
              key={c.id}
              onClick={() => { setSeleccionado(c); setVerRecibo(false); }}
              className="w-full text-left px-3.5 py-3 flex items-center justify-between"
              style={{ background: seleccionado?.id === c.id ? "#EDE7DE" : "transparent", borderBottom: i < clientes.length - 1 ? "1px solid #D9D0C2" : "none" }}
            >
              <div>
                <p className="text-sm">{c.name}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>{c.phone}</p>
              </div>
            </button>
          ))}
          {clientes.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>No hay clientes.</p>}
        </div>

        {inactivos.length > 0 && (
          <div className="mt-3">
            <p className="text-xs mb-1.5 flex items-center gap-1.5" style={{ color: "#5B4E5E" }}><UserX size={12} /> Clientes inactivos</p>
            <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              {inactivos.map((c, i) => (
                <div key={c.phone} className="px-3.5 py-2" style={{ borderBottom: i < inactivos.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                  <p className="text-sm">{c.name}</p>
                  <p className="text-xs" style={{ color: "#5B4E5E" }}>
                    {c.ultima ? `Último depósito: ${new Date(c.ultima).toLocaleDateString("es-BO")}` : "Sin depósitos registrados"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="md:col-span-2">
        {!seleccionado ? (
          <p className="text-sm" style={{ color: "#5B4E5E" }}>Selecciona o crea un cliente.</p>
        ) : (
          <>
            <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              {editando ? (
                <div>
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Nombre</p>
                  <input value={edicion.name} onChange={(e) => setEdicion({ ...edicion, name: e.target.value })}
                    className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Teléfono</p>
                  <input value={edicion.phone} onChange={(e) => setEdicion({ ...edicion, phone: e.target.value })}
                    className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Notas</p>
                  <input value={edicion.notes} onChange={(e) => setEdicion({ ...edicion, notes: e.target.value })}
                    className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                  <div className="flex gap-2">
                    <button onClick={guardarEdicion} className="text-xs px-3 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Guardar</button>
                    <button onClick={() => setEditando(false)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <p className="font-serif text-lg">{seleccionado.name}</p>
                    <p className="text-xs" style={{ color: "#5B4E5E" }}>{seleccionado.phone}</p>
                    {fechaApertura && (
                      <p className="text-xs mt-0.5" style={{ color: "#5B4E5E" }}>
                        Pedido abierto desde el {new Date(fechaApertura).toLocaleDateString("es-BO")}
                      </p>
                    )}
                    {saldo >= 150 && (
                      <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#7A2540" }}>
                        <AlertTriangle size={12} /> Saldo alto — considera avisarle antes de asignar más productos
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 items-end">
                    <a href={linkWhatsapp(seleccionado.phone, mensajeResumen())} target="_blank" rel="noreferrer"
                      className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
                      <MessageCircle size={13} /> Enviar reporte
                    </a>
                    <div className="flex gap-1.5">
                      <button onClick={() => setEditando(true)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                        <Pencil size={12} /> Editar
                      </button>
                      <button onClick={eliminarCliente} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#F4E3E6", color: "#7A2540" }}>
                        <Trash2 size={12} /> Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              <div className="flex items-center justify-between mb-2">
                <p className="font-serif text-base flex items-center gap-2"><Wallet size={15} style={{ color: "#5B4E5E" }} /> Depósitos / amortizaciones</p>
                <button onClick={() => setMostrarDeposito((v) => !v)} className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
                  <Plus size={13} /> Registrar depósito
                </button>
              </div>
              {mostrarDeposito && (
                <div className="flex items-end gap-2 mb-3 p-3 rounded" style={{ background: "#EDE7DE" }}>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Monto (Bs)</p>
                    <input type="number" min={1} value={montoDeposito} onChange={(e) => setMontoDeposito(Number(e.target.value))}
                      className="w-28 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Método</p>
                    <select value={metodoDeposito} onChange={(e) => setMetodoDeposito(e.target.value)}
                      className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                      <option value="efectivo">Efectivo</option>
                      <option value="bancosol">Depósito BancoSol</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="qr">QR</option>
                    </select>
                  </div>
                  <button onClick={registrarDeposito} disabled={montoDeposito <= 0} className="text-xs px-3 py-2 rounded-md" style={{ background: montoDeposito > 0 ? "#9C7A3C" : "#D9D0C2", color: "#F7F3EC" }}>
                    Guardar
                  </button>
                </div>
              )}
              {depositos.length === 0 ? (
                <p className="text-sm" style={{ color: "#5B4E5E" }}>Este cliente todavía no tiene depósitos registrados.</p>
              ) : (
                depositos.map((d, i) => (
                  <div key={d.id} className="flex justify-between text-sm py-1.5" style={{ borderBottom: i < depositos.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                    <span style={{ color: "#5B4E5E" }}>{new Date(d.paid_at).toLocaleDateString("es-BO")} · {d.method}</span>
                    <span className="font-serif">Bs {d.amount}</span>
                  </div>
                ))
              )}
              <div className="flex justify-between text-sm mt-2 pt-2" style={{ borderTop: "1px solid #D9D0C2" }}>
                <span style={{ color: "#5B4E5E" }}>Total depositado</span>
                <span className="font-serif" style={{ color: "#4F6F52" }}>Bs {depositado}</span>
              </div>
            </div>

            {verRecibo ? (
              <div className="flex flex-col items-center">
                <div id="recibo-termico" style={{ background: "#fff", color: "#111", width: 280, fontFamily: "monospace" }} className="p-3 text-xs shadow-md">
                  <p className="font-cursive text-center" style={{ fontSize: "1.3rem" }}>{nombreNegocio}</p>
                  <p className="text-center mb-1">Recibo de pedido</p>
                  <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                  <p>Cliente: {seleccionado.name}</p>
                  <p>Tel: {seleccionado.phone}</p>
                  <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                  {items.map((it) => (
                    <div key={it.id} className="flex justify-between">
                      <span>{it.codigo} x{it.cantidad}</span>
                      <span>Bs {precioUnitario(reglas, it.categoria_id, it.cantidad, it.precio_base) * it.cantidad}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                  <div className="flex justify-between"><span>Descuento cant.</span><span>-Bs {descuentoTotal}</span></div>
                  <div className="flex justify-between font-bold"><span>Total</span><span>Bs {total}</span></div>
                  <div className="flex justify-between"><span>Depósitos</span><span>Bs {depositado}</span></div>
                  <div className="flex justify-between font-bold"><span>Saldo</span><span>Bs {saldo}</span></div>
                  <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                  <p className="text-center">¡Gracias por tu compra!</p>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => window.print()} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                    <Printer size={13} /> Imprimir (térmica 8x8 cm)
                  </button>
                  <button onClick={() => setVerRecibo(false)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                    Volver al pedido
                  </button>
                </div>
              </div>
            ) : (
              <>
                {(Object.entries(porCategoria) as [string, ItemDetalle[]][]).map(([cat, filas]) => (
                  <div key={cat} className="mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                    <div className="px-3.5 py-2" style={{ borderBottom: "1px solid #D9D0C2", color: "#7A5F2D" }}>
                      <p className="text-sm font-medium">{cat}</p>
                    </div>
                    {filas.map((it) => {
                      const pu = precioUnitario(reglas, it.categoria_id, it.cantidad, it.precio_base);
                      return (
                        <div key={it.id} className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                          <div>
                            <p className="text-sm">{it.nombre}</p>
                            <p className="text-xs" style={{ color: "#5B4E5E" }}>{it.codigo} · {it.cantidad} × Bs {pu} · asignado {it.fecha}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-serif text-sm">Bs {pu * it.cantidad}</span>
                            <button onClick={() => quitarUnidad(it.id)} className="p-1 rounded" style={{ color: "#7A2540" }} title="Quitar una unidad">
                              <Minus size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {items.length === 0 && <p className="text-sm mb-3" style={{ color: "#5B4E5E" }}>Este cliente no tiene un pedido abierto.</p>}

                <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                  <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Subtotal sin descuento</span><span>Bs {subtotalSinDescuento}</span></div>
                  <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#4F6F52" }}>Descuento por cantidad</span><span style={{ color: "#4F6F52" }}>− Bs {descuentoTotal}</span></div>
                  <div className="flex justify-between text-sm mb-1.5 pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>Total</span><span className="font-serif">Bs {total}</span></div>
                  <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Depósitos</span><span>Bs {depositado}</span></div>
                  <div className="flex justify-between text-sm pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#7A2540" }}>Saldo</span><span className="font-serif" style={{ color: "#7A2540" }}>Bs {saldo}</span></div>
                </div>

                {ordenId && (
                  <div className="flex gap-2">
                    <button onClick={cerrarPedido} className="flex-1 py-2.5 rounded-md text-sm" style={{ background: "#2B1E2E", color: "#F7F3EC" }}>
                      Cerrar pedido
                    </button>
                    <button onClick={() => setVerRecibo(true)} className="flex-1 py-2.5 rounded-md text-sm flex items-center justify-center gap-2" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                      <Printer size={15} /> Ver / imprimir recibo
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
