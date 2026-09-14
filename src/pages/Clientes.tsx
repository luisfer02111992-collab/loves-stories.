import React, { useEffect, useMemo, useState } from "react";
import { Plus, Minus, MessageCircle, FileDown, AlertTriangle, UserX, Pencil, Trash2, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import { loadPricingRules, agruparPorProducto, PricingRule, LineaPedido, GrupoProducto } from "../lib/pricing";
import { generarPdfPedido } from "../lib/pdf";
import type { Customer } from "../lib/types";

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
  const [items, setItems] = useState<LineaPedido[]>([]);
  const [depositos, setDepositos] = useState<DepositoDetalle[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [nombreNegocio, setNombreNegocio] = useState("Loves Stories");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [inactivos, setInactivos] = useState<{ name: string; phone: string; ultima: string | null }[]>([]);
  const [editando, setEditando] = useState(false);
  const [edicion, setEdicion] = useState({ name: "", phone: "", notes: "" });
  const [mostrarDeposito, setMostrarDeposito] = useState(false);
  const [montoDeposito, setMontoDeposito] = useState(0);
  const [metodoDeposito, setMetodoDeposito] = useState("efectivo");
  const [ultimoPdf, setUltimoPdf] = useState<{ blob: Blob; texto: string } | null>(null);
  const [cerrando, setCerrando] = useState(false);

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
      setUltimoPdf(null);
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
    const { data } = await supabase.from("customers").select("name, phone, payments(paid_at)").is("deleted_at", null);
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
        .select("id, product_id, quantity, unit_price, assigned_at, products(code, name, category_id)")
        .eq("order_id", orden.id)
        .order("assigned_at", { ascending: true });
      const detalle: LineaPedido[] = (filas ?? []).map((f: any) => ({
        id: f.id,
        product_id: f.product_id,
        codigo: f.products?.code ?? "",
        nombre: f.products?.name ?? "",
        categoria_id: f.products?.category_id ?? null,
        cantidad: f.quantity,
        precio_base: f.unit_price,
        fecha: new Date(f.assigned_at).toLocaleDateString("es-BO"),
      }));
      setItems(detalle);
    }

    const { data: pagos } = await supabase.from("payments").select("id, amount, method, paid_at").eq("customer_id", customerId).order("paid_at", { ascending: false });
    setDepositos((pagos as DepositoDetalle[]) ?? []);
  }

  const grupos: GrupoProducto[] = useMemo(() => agruparPorProducto(reglas, items), [items, reglas]);
  const subtotalSinDescuento = grupos.reduce((a, g) => a + g.subtotalSinDescuento, 0);
  const total = grupos.reduce((a, g) => a + g.subtotalConDescuento, 0);
  const descuentoTotal = subtotalSinDescuento - total;
  const depositado = depositos.reduce((a, d) => a + d.amount, 0);
  const saldo = total - depositado;

  async function quitarUnidad(itemId: string) {
    await supabase.rpc("remove_order_item_unit", { p_order_item_id: itemId, p_quantity: 1 });
    if (seleccionado) cargarPedido(seleccionado.id);
  }

  async function cerrarPedido() {
    if (!ordenId || !seleccionado) return;
    setCerrando(true);
    // El total y el pago final se calculan y registran DENTRO de Supabase (calcular_total_pedido
    // + close_order), no se envía ningún total desde el navegador.
    const { error } = await supabase.rpc("close_order", { p_order_id: ordenId });
    if (error) {
      alert(error.message);
      setCerrando(false);
      return;
    }
    const { data: pagoFinalRow } = await supabase
      .from("payments")
      .select("amount")
      .eq("order_id", ordenId)
      .eq("method", "cierre_pedido")
      .order("paid_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const pagoFinal = pagoFinalRow?.amount ?? 0;
    const blob = generarPdfPedido({
      negocio: nombreNegocio,
      cliente: seleccionado.name,
      telefono: seleccionado.phone,
      fecha: new Date().toLocaleDateString("es-BO"),
      grupos,
      subtotalSinDescuento,
      descuentoTotal,
      total,
      depositado,
      saldo: 0,
      cerrado: true,
      pagoFinal,
    });
    setUltimoPdf({ blob, texto: mensajeWhatsapp(true, pagoFinal) });
    setCerrando(false);
    await cargarPedido(seleccionado.id);
    await cargarClientes();
  }

  function generarPdfAbierto() {
    if (!seleccionado) return;
    const blob = generarPdfPedido({
      negocio: nombreNegocio,
      cliente: seleccionado.name,
      telefono: seleccionado.phone,
      fecha: new Date().toLocaleDateString("es-BO"),
      grupos,
      subtotalSinDescuento,
      descuentoTotal,
      total,
      depositado,
      saldo,
      cerrado: false,
    });
    setUltimoPdf({ blob, texto: mensajeWhatsapp(false) });
  }

  function mensajeWhatsapp(cerrado: boolean, pagoFinal?: number) {
    if (!seleccionado) return "";
    if (cerrado) {
      return `Hola ${seleccionado.name}. Te comparto el recibo de tu compra en ${nombreNegocio}. Total: Bs ${total}. Pago final registrado: Bs ${(pagoFinal ?? 0).toFixed(2)}. Saldo: Bs 0. Te adjunto el PDF que acabamos de descargar.`;
    }
    return `Hola ${seleccionado.name}. Te comparto el detalle de tu pedido en ${nombreNegocio} hasta hoy. Total: Bs ${total}. Depósitos: Bs ${depositado}. Saldo: Bs ${saldo}. Te adjunto el PDF que acabamos de descargar.`;
  }

  function linkWhatsapp(telefono: string, mensaje: string) {
    const limpio = telefono.replace(/\D/g, "");
    return `https://wa.me/${limpio}?text=${encodeURIComponent(mensaje)}`;
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
    await supabase.from("payments").insert({ customer_id: seleccionado.id, order_id: ordenId, amount: montoDeposito, method: metodoDeposito });
    setMontoDeposito(0);
    setMostrarDeposito(false);
    await cargarPedido(seleccionado.id);
    await cargarInactivos();
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
            <button key={c.id} onClick={() => setSeleccionado(c)} className="w-full text-left px-3.5 py-3 flex items-center justify-between"
              style={{ background: seleccionado?.id === c.id ? "#EDE7DE" : "transparent", borderBottom: i < clientes.length - 1 ? "1px solid #D9D0C2" : "none" }}>
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
                  <div className="flex gap-1.5">
                    <button onClick={() => setEditando(true)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                      <Pencil size={12} /> Editar
                    </button>
                    <button onClick={eliminarCliente} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#F4E3E6", color: "#7A2540" }}>
                      <Trash2 size={12} /> Eliminar
                    </button>
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

            {grupos.length === 0 ? (
              <p className="text-sm mb-3" style={{ color: "#5B4E5E" }}>Este cliente no tiene un pedido abierto.</p>
            ) : (
              <div className="mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                {grupos.map((g, i) => (
                  <div key={g.product_id} className="px-3.5 py-2.5" style={{ borderBottom: i < grupos.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm">{g.codigo} · {g.nombre} × {g.cantidadTotal}</p>
                      <div className="flex items-center gap-3">
                        <span className="font-serif text-sm">Bs {g.subtotalConDescuento.toFixed(2)}</span>
                        <button onClick={() => quitarUnidad(g.detalle[g.detalle.length - 1].id)} className="p-1 rounded" style={{ color: "#7A2540" }} title="Quitar una unidad (de la última asignación)">
                          <Minus size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "#5B4E5E" }}>
                      {g.detalle.map((d) => `${d.cantidad} unidad(es) — ${d.fecha}`).join(" · ")}
                      {g.descuento > 0 && ` · descuento aplicado: Bs ${g.descuento.toFixed(2)}`}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Subtotal sin descuento</span><span>Bs {subtotalSinDescuento.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#4F6F52" }}>Descuento por cantidad</span><span style={{ color: "#4F6F52" }}>− Bs {descuentoTotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm mb-1.5 pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>Total</span><span className="font-serif">Bs {total.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Depósitos</span><span>Bs {depositado.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#7A2540" }}>Saldo</span><span className="font-serif" style={{ color: "#7A2540" }}>Bs {saldo.toFixed(2)}</span></div>
            </div>

            {ordenId && (
              <div className="flex gap-2 mb-3">
                <button onClick={cerrarPedido} disabled={cerrando} className="flex-1 py-2.5 rounded-md text-sm" style={{ background: "#2B1E2E", color: "#F7F3EC" }}>
                  {cerrando ? "Cerrando..." : "Cerrar pedido (pago completo)"}
                </button>
                <button onClick={generarPdfAbierto} className="flex-1 py-2.5 rounded-md text-sm flex items-center justify-center gap-2" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                  <FileDown size={15} /> PDF del pedido abierto
                </button>
              </div>
            )}

            {ultimoPdf && (
              <div className="p-3 rounded-md flex items-center justify-between" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C" }}>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>
                  PDF descargado. WhatsApp Web no permite adjuntarlo automáticamente desde el navegador:
                  abre el chat y adjunta el archivo que se acaba de descargar.
                </p>
                <a href={linkWhatsapp(seleccionado.phone, ultimoPdf.texto)} target="_blank" rel="noreferrer"
                  className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5 shrink-0 ml-2" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
                  <MessageCircle size={13} /> Abrir chat
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
