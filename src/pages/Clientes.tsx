import React, { useEffect, useMemo, useState } from "react";
import { Plus, Minus, MessageCircle, FileDown, AlertTriangle, UserX, Pencil, Trash2, Wallet, Printer, Bell } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSellerSession } from "../hooks/useSellerSession";
import { useAuth } from "../hooks/useAuth";
import { loadPricingRules, agruparPorProducto, PricingRule, LineaPedido, GrupoProducto } from "../lib/pricing";
import { generarPdfGrande } from "../lib/pdf";
import type { Customer } from "../lib/types";
import { imprimirTicket } from "../lib/print";

interface DepositoDetalle {
  id: string;
  amount: number; // saldo todavía disponible de este depósito
  original_amount?: number;
  applied_amount?: number;
  method: string;
  paid_at: string;
}

const PLAZO_DIAS = 5;

export default function Clientes() {
  const { vendedorActivoId, sesionActivaId } = useSellerSession();
  const { userId, profile } = useAuth();
  const [productoSeleccionado, setProductoSeleccionado] = useState<string | null>(null);
  const [depositoSeleccionado, setDepositoSeleccionado] = useState<string | null>(null);
  const [guardandoDeposito, setGuardandoDeposito] = useState(false);
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [pestanaClientes, setPestanaClientes] = useState<"abiertas" | "cerradas">("abiertas");
  const [clientesAbiertos, setClientesAbiertos] = useState<Set<string>>(new Set());
  const [seleccionado, setSeleccionado] = useState<Customer | null>(null);
  const [ordenId, setOrdenId] = useState<string | null>(null);
  const [fechaApertura, setFechaApertura] = useState<string | null>(null);
  const [items, setItems] = useState<LineaPedido[]>([]);
  const [depositos, setDepositos] = useState<DepositoDetalle[]>([]);
  const [disponible, setDisponible] = useState(0);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [nombreNegocio, setNombreNegocio] = useState("Loves Stories");
  const [telefonoNegocio, setTelefonoNegocio] = useState("");
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
  const [mostrarResumenCierre, setMostrarResumenCierre] = useState(false);
  const [mostrarRecibo, setMostrarRecibo] = useState(false);
  const [mostrarRecordatorio, setMostrarRecordatorio] = useState(false);
  const [mensajeRecordatorio, setMensajeRecordatorio] = useState("");
  const [pendienteSobrante, setPendienteSobrante] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [mostrarSelectorFecha, setMostrarSelectorFecha] = useState(false);
  const [editandoPrecio, setEditandoPrecio] = useState<string | null>(null);
  const [precioManual, setPrecioManual] = useState(0);
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);

  useEffect(() => {
    cargarClientes();
    loadPricingRules().then(setReglas);
    supabase.from("app_settings").select("business_name, whatsapp_number").eq("id", 1).single().then(({ data }) => {
      if (data?.business_name) setNombreNegocio(data.business_name);
      setTelefonoNegocio(data?.whatsapp_number ?? "");
    });
    cargarInactivos();
  }, []);

  useEffect(() => {
    const visibles=clientes.filter(c=>pestanaClientes==="abiertas"?clientesAbiertos.has(c.id):!clientesAbiertos.has(c.id));
    if (!seleccionado || !visibles.some(c=>c.id===seleccionado.id)) setSeleccionado(visibles[0] ?? null);
  }, [pestanaClientes, clientesAbiertos]);

  useEffect(() => {
    if (seleccionado) {
      cargarPedido(seleccionado.id);
      setEdicion({ name: seleccionado.name, phone: seleccionado.phone, notes: seleccionado.notes ?? "" });
      setEditando(false);
      setMostrarDeposito(false);
      setUltimoPdf(null);
      setMostrarResumenCierre(false);
      setMostrarRecibo(false);
      setMostrarRecordatorio(false);
    }
  }, [seleccionado]);

  async function cargarClientes() {
    const [{ data }, { data: abiertas }] = await Promise.all([
      supabase.from("customers").select("*").is("deleted_at", null).order("name"),
      supabase.from("orders").select("customer_id").in("status", ["open", "reopened"])
    ]);
    const lista=(data as Customer[]) ?? [];
    const ids=new Set<string>((abiertas ?? []).map((o:any)=>o.customer_id).filter(Boolean));
    setClientes(lista); setClientesAbiertos(ids);
    const visibles=lista.filter(c=>pestanaClientes==="abiertas"?ids.has(c.id):!ids.has(c.id));
    if (!seleccionado || !visibles.some(c=>c.id===seleccionado.id)) setSeleccionado(visibles[0] ?? null);
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
        .select("id, product_id, quantity, unit_price, assigned_at, products(code, name, category_id, image_url)")
        .eq("order_id", orden.id)
        .order("assigned_at", { ascending: true });
      const detalle: LineaPedido[] = (filas ?? []).map((f: any) => ({
        id: f.id,
        product_id: f.product_id,
        codigo: f.products?.code ?? "",
        nombre: f.products?.name ?? "",
        categoria_id: f.products?.category_id ?? null,
        imagen: f.products?.image_url ?? null,
        cantidad: f.quantity,
        precio_base: f.unit_price,
        fecha: new Date(f.assigned_at).toLocaleDateString("es-BO"),
      }));
      setItems(detalle);
    }

    // Dinero realmente disponible: cada depósito conserva cuánto ya fue
    // aplicado a ciclos cerrados. Así un depósito usado NO reaparece en el
    // siguiente pedido y un sobrante real sí continúa como saldo a favor.
    const { data: pagos } = await supabase
      .from("payments")
      .select("id, amount, applied_amount, method, paid_at")
      .eq("customer_id", customerId)
      .order("paid_at", { ascending: false });
    const disponibles: DepositoDetalle[] = (pagos ?? [])
      .filter((p: any) => p.method !== "cierre_pedido" && p.method !== "devolucion_sobrante")
      .map((p: any) => ({
        id: p.id, method: p.method, paid_at: p.paid_at,
        original_amount: Number(p.amount ?? 0),
        applied_amount: Number(p.applied_amount ?? 0),
        amount: Math.max(0, Number(p.amount ?? 0) - Number(p.applied_amount ?? 0)),
      }))
      .filter((p) => p.amount > 0.0001);
    setDepositos(disponibles);
    setDisponible(disponibles.reduce((a, p) => a + p.amount, 0));
  }

  const grupos: GrupoProducto[] = useMemo(() => agruparPorProducto(reglas, items), [items, reglas]);

  function resumenFechas(g: GrupoProducto) {
    const porFecha = new Map<string, number>();
    for (const d of g.detalle) porFecha.set(d.fecha, (porFecha.get(d.fecha) ?? 0) + d.cantidad);
    return Array.from(porFecha.entries()).map(([fecha, cantidad]) => `${fecha}: ${cantidad} un.`).join(" · ");
  }

  // Supr/Delete: quita el producto o el depósito seleccionado (con la misma
  // confirmación que el botón correspondiente), sin interferir con lo que
  // se esté escribiendo en un campo de texto.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const activo = document.activeElement;
      const enCampoDeTexto = activo && (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA" || activo.tagName === "SELECT");
      if (enCampoDeTexto) return;
      if (productoSeleccionado) {
        e.preventDefault();
        const g = grupos.find((x) => x.product_id === productoSeleccionado);
        if (g) quitarProductoCompleto(g);
      } else if (depositoSeleccionado) {
        e.preventDefault();
        const d = depositos.find((x) => x.id === depositoSeleccionado);
        if (d) eliminarDeposito(d);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoSeleccionado, depositoSeleccionado, grupos, depositos]);
  const subtotalSinDescuento = grupos.reduce((a, g) => a + g.subtotalSinDescuento, 0);
  const total = grupos.reduce((a, g) => a + g.subtotalConDescuento, 0);
  const descuentoTotal = subtotalSinDescuento - total;
  const depositado = depositos.reduce((a, d) => a + d.amount, 0);
  // Nunca se muestra un número negativo: se separa en "saldo a favor" (pagó de
  // más) o "saldo pendiente" (falta pagar), nunca los dos a la vez. Usa el
  // "banco del cliente" (disponible), no la simple suma de depósitos, para
  // no volver a contar dinero que ya se consumió en un pedido cerrado anterior.
  const diferencia = total - disponible; // > 0 = pendiente, < 0 = a favor
  const saldoPendiente = Math.max(0, diferencia);
  const saldoAFavor = Math.max(0, -diferencia);

  // Semáforo de plazo: verde/amarillo/rojo según los días desde la apertura.
  // El rojo es solo una advertencia visual — nunca bloquea nada.
  const diasApertura = fechaApertura ? Math.floor((Date.now() - new Date(fechaApertura).getTime()) / 86400000) : 0;
  const semaforo = diasApertura >= PLAZO_DIAS ? "rojo" : diasApertura >= PLAZO_DIAS - 1 ? "amarillo" : "verde";  const colorSemaforo = { verde: "#4F6F52", amarillo: "#B7791F", rojo: "#7A2540" }[semaforo];
  const textoSemaforo = { verde: "Plazo vigente", amarillo: "Se acerca al vencimiento", rojo: "Plazo vencido (aviso, no bloquea)" }[semaforo];

  async function guardarPrecioManual(productId: string) {
    if (!ordenId || guardandoPrecio || precioManual < 0) return;
    setGuardandoPrecio(true);
    const { error } = await supabase.rpc("update_open_order_product_price", {
      p_order_id: ordenId, p_product_id: productId, p_unit_price: precioManual,
    });
    setGuardandoPrecio(false);
    if (error) { alert(error.message); return; }
    setEditandoPrecio(null);
    if (seleccionado) await cargarPedido(seleccionado.id);
  }

  async function quitarUnidad(itemId: string) {
    const { error } = await supabase.rpc("remove_order_item_unit", { p_order_item_id: itemId, p_quantity: 1 });
    if (error) { alert(`No se pudo disminuir: ${error.message}`); return; }
    if (seleccionado) await cargarPedido(seleccionado.id);
  }

  async function aumentarUnidad(productId: string) {
    if (!ordenId) return;
    await supabase.rpc("assign_product_to_order", {
      p_order_id: ordenId, p_product_id: productId, p_quantity: 1, p_origin: "manual",
      p_seller_id: vendedorActivoId, p_session_id: sesionActivaId,
    });
    if (seleccionado) cargarPedido(seleccionado.id);
  }

  async function quitarProductoCompleto(g: GrupoProducto) {
    if (!confirm(`¿Quitar "${g.nombre}" completo (${g.cantidadTotal} unidades) de este pedido? Se devuelve todo al inventario.`)) return;
    for (const d of g.detalle) {
      const { error } = await supabase.rpc("remove_order_item_unit", { p_order_item_id: d.id, p_quantity: d.cantidad });
      if (error) { alert(`No se pudo eliminar el producto: ${error.message}`); return; }
    }
    setProductoSeleccionado(null);
    if (seleccionado) await cargarPedido(seleccionado.id);
  }

  // Eliminar un depósito registrado por error: pide confirmación, deja
  // constancia en audit_log de qué se borró y por qué (nunca se borra en
  // silencio), y recalcula solo automáticamente porque saldo/disponible
  // se recalculan a partir de la lista de depósitos.
  async function eliminarDeposito(d: DepositoDetalle) {
    if ((d.applied_amount ?? 0) > 0) {
      alert("Este depósito ya fue utilizado total o parcialmente en un pedido cerrado y no puede eliminarse desde el pedido abierto. Su historial debe conservarse.");
      return;
    }
    const motivo = prompt(`¿Eliminar el depósito de Bs ${d.amount} (${d.method}, ${new Date(d.paid_at).toLocaleDateString("es-BO")})? Escribe el motivo para continuar:`);
    if (!motivo) return;
    await supabase.from("audit_log").insert({
      actor: userId,
      action: "deposito_eliminado",
      details: { payment_id: d.id, customer_id: seleccionado?.id, amount: d.amount, method: d.method, paid_at: d.paid_at, motivo },
    });
    await supabase.from("payments").delete().eq("id", d.id);
    setDepositoSeleccionado(null);
    if (seleccionado) cargarPedido(seleccionado.id);
  }

  async function confirmarCierre() {
    if (!ordenId || !seleccionado || cerrando) return;
    setCerrando(true);
    // Seguridad financiera: el total que cerrará Supabase debe coincidir con
    // el total que ve el usuario. Si no coincide, no consumimos depósitos.
    const { data: totalServidor, error: errorTotal } = await supabase.rpc("calcular_total_pedido", { p_order_id: ordenId });
    if (errorTotal) { alert(errorTotal.message); setCerrando(false); return; }
    if (Math.abs(Number(totalServidor ?? 0) - total) > 0.01) {
      alert(`No se cerró el pedido porque el total del servidor (Bs ${Number(totalServidor ?? 0).toFixed(2)}) no coincide con el total mostrado (Bs ${total.toFixed(2)}). Actualiza la página y vuelve a revisar.`);
      setCerrando(false);
      return;
    }
    const { error } = await supabase.rpc("close_order", { p_order_id: ordenId });
    if (error) {
      alert(error.message);
      setCerrando(false);
      return;
    }
    // Sello explícito y verificable del usuario autenticado que hizo el cierre.
    // Evita que un cierre nuevo quede como “No registrado”.
    const { error: selloError } = await supabase.rpc("stamp_order_closer", { p_order_id: ordenId });
    if (selloError) {
      alert(`El pedido se cerró, pero no se pudo registrar quién lo cerró: ${selloError.message}`);
    }
    // close_order NUNCA registra un pago — el saldo que queda tras cerrar es
    // exactamente el mismo saldo a favor / pendiente que ya se mostraba
    // antes de cerrar (con dinero realmente depositado, nada inventado).
    const blob = await generarPdfGrande({
      negocio: nombreNegocio, cliente: seleccionado.name, telefono: seleccionado.phone,
      fecha: new Date().toLocaleDateString("es-BO"), titulo: "Cuenta cerrada",
      grupos, subtotalSinDescuento, descuentoTotal, total,
      depositado, saldoPendiente, saldoAFavor, mostrarPagos: true,
    });
    setUltimoPdf({ blob, texto: mensajeWhatsapp(true) });
    setCerrando(false);
    setMostrarResumenCierre(false);
    await cargarPedido(seleccionado.id);
    await cargarClientes();
  }

  // Sobrante al cerrar: si queda saldo a favor, preguntar qué hacer (nunca decidir solo).
  async function devolverSobrante() {
    if (!seleccionado || saldoAFavor <= 0) return;
    if (!confirm(`¿Confirmas que devolviste Bs ${saldoAFavor.toFixed(2)} al cliente?`)) return;
    const { error } = await supabase.rpc("refund_customer_credit", { p_customer_id: seleccionado.id, p_amount: saldoAFavor });
    if (error) { alert(error.message); return; }
    setPendienteSobrante(false);
    await cargarPedido(seleccionado.id);
  }

  async function generarPdfAbierto() {
    if (!seleccionado) return;
    setGenerandoPdf(true);
    const blob = await generarPdfGrande({
      negocio: nombreNegocio, cliente: seleccionado.name, telefono: seleccionado.phone,
      fecha: new Date().toLocaleDateString("es-BO"), titulo: "Pedido acumulado",
      grupos, subtotalSinDescuento, descuentoTotal, total,
      depositado, saldoPendiente, saldoAFavor, mostrarPagos: true,
    });
    setGenerandoPdf(false);
    setUltimoPdf({ blob, texto: mensajeWhatsapp(false) });
  }

  // PDF por fecha: solo lo asignado ese día puntual, no todo el acumulado.
  // No modifica ni cierra el pedido.
  const fechasConAsignaciones = useMemo(() => Array.from(new Set(items.map((it) => it.fecha))).sort().reverse(), [items]);

  async function generarPdfPorFecha(fechaElegida: string) {
    if (!seleccionado) return;
    const itemsDeEseDia = items.filter((it) => it.fecha === fechaElegida);
    const gruposDia = agruparPorProducto(reglas, itemsDeEseDia);
    const subDia = gruposDia.reduce((a, g) => a + g.subtotalSinDescuento, 0);
    const totalDia = gruposDia.reduce((a, g) => a + g.subtotalConDescuento, 0);
    setGenerandoPdf(true);
    await generarPdfGrande({
      negocio: nombreNegocio, cliente: seleccionado.name, telefono: seleccionado.phone,
      fecha: fechaElegida, titulo: `Detalle del ${fechaElegida}`,
      grupos: gruposDia, subtotalSinDescuento: subDia, descuentoTotal: subDia - totalDia, total: totalDia,
      depositado: 0, saldoPendiente: 0, saldoAFavor: 0, mostrarPagos: false,
    });
    setGenerandoPdf(false);
    setMostrarSelectorFecha(false);
  }

  function mensajeWhatsapp(cerrado: boolean) {
    if (!seleccionado) return "";
    if (cerrado) {
      return `Hola ${seleccionado.name}. Te comparto el recibo de tu compra en ${nombreNegocio}. Total: Bs ${total.toFixed(2)}. Depositado: Bs ${depositado.toFixed(2)}. ${saldoAFavor > 0 ? `Saldo a favor: Bs ${saldoAFavor.toFixed(2)}` : `Saldo pendiente: Bs ${saldoPendiente.toFixed(2)}`}. Te adjunto el PDF que acabamos de descargar.`;
    }
    return `Hola ${seleccionado.name}. Te comparto el detalle de tu pedido en ${nombreNegocio} hasta hoy. Total: Bs ${total.toFixed(2)}. Depósitos: Bs ${depositado.toFixed(2)}. ${saldoAFavor > 0 ? `Saldo a favor: Bs ${saldoAFavor.toFixed(2)}` : `Saldo pendiente: Bs ${saldoPendiente.toFixed(2)}`}. Te adjunto el PDF que acabamos de descargar.`;
  }

  function abrirRecordatorio() {
    if (!seleccionado) return;
    const msg = `Hola ${seleccionado.name}, te escribimos de ${nombreNegocio}. Tu pedido: Bs ${total.toFixed(2)}. Pagado: Bs ${depositado.toFixed(2)}. Saldo pendiente: Bs ${saldoPendiente.toFixed(2)}. Llevas ${diasApertura} día(s) desde la apertura` +
      (semaforo === "rojo" ? " y tu plazo de 5 días ya se cumplió." : semaforo === "amarillo" ? ", tu plazo de 5 días está por cumplirse." : ".") +
      ` Te pedimos completar el pago cuando puedas. ¡Gracias!`;
    setMensajeRecordatorio(msg);
    setMostrarRecordatorio(true);
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
    if (!seleccionado || montoDeposito <= 0 || guardandoDeposito) return;
    setGuardandoDeposito(true);
    const { error } = await supabase.rpc("register_customer_deposit", { p_customer_id: seleccionado.id, p_amount: montoDeposito, p_method: metodoDeposito });
    if (error) { alert(error.message); setGuardandoDeposito(false); return; }
    setMontoDeposito(0);
    setMostrarDeposito(false);
    setGuardandoDeposito(false);
    // Registrar un pago renueva el plazo de 5 días (vuelve a verde) y NUNCA cierra el pedido.
    await cargarClientes();
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

        <div className="flex gap-1 mb-2">
          <button onClick={()=>setPestanaClientes("abiertas")} className="text-xs px-3 py-2 rounded" style={{background:pestanaClientes==="abiertas"?"#9C7A3C":"#EDE7DE",color:pestanaClientes==="abiertas"?"white":"#5B4E5E"}}>Cuentas abiertas</button>
          <button onClick={()=>setPestanaClientes("cerradas")} className="text-xs px-3 py-2 rounded" style={{background:pestanaClientes==="cerradas"?"#9C7A3C":"#EDE7DE",color:pestanaClientes==="cerradas"?"white":"#5B4E5E"}}>Cuentas cerradas</button>
        </div>
        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {clientes.filter(c=>pestanaClientes==="abiertas"?clientesAbiertos.has(c.id):!clientesAbiertos.has(c.id)).map((c, i, arr) => (
            <div key={c.id} className="px-3.5 py-3 flex items-center justify-between gap-2" style={{ background: seleccionado?.id === c.id ? "#EDE7DE" : "transparent", borderBottom: i < arr.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <button onClick={() => setSeleccionado(c)} className="flex-1 text-left">
                <p className="text-sm">{c.name}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>{c.phone}</p>
              </button>
              <a href={`https://wa.me/${c.phone.replace(/\D/g, "").replace(/^0+/, "")}`} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()} className="w-8 h-8 rounded-full flex items-center justify-center" style={{background:"#E4F3E7",color:"#2F6B3A"}} title={`WhatsApp de ${c.name}`}>
                <MessageCircle size={15}/>
              </a>
            </div>
          ))}
          {clientes.filter(c=>pestanaClientes==="abiertas"?clientesAbiertos.has(c.id):!clientesAbiertos.has(c.id)).length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>No hay clientes en esta lista.</p>}
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
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: colorSemaforo }} />
                        <p className="text-xs" style={{ color: colorSemaforo }}>
                          Apertura: {new Date(fechaApertura).toLocaleDateString("es-BO")} · día {diasApertura} de {PLAZO_DIAS} · {textoSemaforo}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 items-end">
                    <div className="flex gap-1.5">
                      <button onClick={() => setEditando(true)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                        <Pencil size={12} /> Editar
                      </button>
                      <button onClick={eliminarCliente} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#F4E3E6", color: "#7A2540" }}>
                        <Trash2 size={12} /> Eliminar
                      </button>
                    </div>
                    {fechaApertura && (semaforo === "amarillo" || semaforo === "rojo") && (
                      <button onClick={abrirRecordatorio} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
                        <Bell size={12} /> Enviar recordatorio
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {mostrarRecordatorio && (
              <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                <p className="text-xs mb-1.5" style={{ color: "#5B4E5E" }}>Mensaje (puedes editarlo antes de enviar)</p>
                <textarea value={mensajeRecordatorio} onChange={(e) => setMensajeRecordatorio(e.target.value)} rows={4}
                  className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                <div className="flex gap-2">
                  <a href={linkWhatsapp(seleccionado.phone, mensajeRecordatorio)} target="_blank" rel="noreferrer"
                    className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
                    <MessageCircle size={13} /> Enviar por WhatsApp
                  </a>
                  <button onClick={() => setMostrarRecordatorio(false)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>Cancelar</button>
                </div>
              </div>
            )}

            <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              <div className="flex items-center justify-between mb-2">
                <p className="font-serif text-base flex items-center gap-2"><Wallet size={15} style={{ color: "#5B4E5E" }} /> Depósitos / amortizaciones</p>
                <button onClick={() => setMostrarDeposito((v) => !v)} className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
                  <Plus size={13} /> Registrar depósito
                </button>
              </div>
              <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Puedes abrir una cuenta con cualquier monto — Bs 300 es solo la garantía habitual, no un mínimo obligatorio.</p>
              {mostrarDeposito && (
                <form onSubmit={(e) => { e.preventDefault(); registrarDeposito(); }} className="flex items-end gap-2 mb-3 p-3 rounded" style={{ background: "#EDE7DE" }}>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Monto (Bs)</p>
                    <input type="number" min={1} autoFocus value={montoDeposito} onChange={(e) => setMontoDeposito(Number(e.target.value))}
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
                  <button type="submit" disabled={montoDeposito <= 0 || guardandoDeposito} className="text-xs px-3 py-2 rounded-md" style={{ background: montoDeposito > 0 ? "#9C7A3C" : "#D9D0C2", color: "#F7F3EC" }}>
                    {guardandoDeposito ? "Guardando..." : "Guardar (Enter)"}
                  </button>
                </form>
              )}
              {depositos.length === 0 ? (
                <p className="text-sm" style={{ color: "#5B4E5E" }}>Este cliente todavía no tiene depósitos registrados.</p>
              ) : (
                depositos.map((d, i) => (
                  <div key={d.id} onClick={() => setDepositoSeleccionado(d.id)}
                    className="flex justify-between text-sm py-1.5 px-1.5 cursor-pointer items-center" style={{ borderBottom: i < depositos.length - 1 ? "1px solid #D9D0C2" : "none", background: depositoSeleccionado === d.id ? "#EDE7DE" : "transparent" }}>
                    <span style={{ color: "#5B4E5E" }}>{new Date(d.paid_at).toLocaleDateString("es-BO")} · {d.method}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-serif">Bs {d.amount}</span>
                      <button onClick={(e) => { e.stopPropagation(); eliminarDeposito(d); }} className="p-1 rounded" style={{ color: "#7A2540" }} title="Eliminar depósito (Supr)">
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                ))
              )}
              <div className="flex justify-between text-sm mt-2 pt-2" style={{ borderTop: "1px solid #D9D0C2" }}>
                <span style={{ color: "#5B4E5E" }}>Disponible para este pedido</span>
                <span className="font-serif" style={{ color: "#4F6F52" }}>Bs {depositado.toFixed(2)}</span>
              </div>
            </div>

            {grupos.length === 0 ? (
              <p className="text-sm mb-3" style={{ color: "#5B4E5E" }}>Este cliente no tiene un pedido abierto.</p>
            ) : (
              <div className="mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                {grupos.map((g, i) => (
                  <div key={g.product_id} onClick={() => setProductoSeleccionado(g.product_id)}
                    className="px-3.5 py-2.5 cursor-pointer" style={{ borderBottom: i < grupos.length - 1 ? "1px solid #D9D0C2" : "none", background: productoSeleccionado === g.product_id ? "#EDE7DE" : "transparent" }}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm">{g.codigo} · {g.nombre} × {g.cantidadTotal}</p>
                      <div className="flex items-center gap-2">
                        {editandoPrecio === g.product_id ? (
                          <form onSubmit={(e) => { e.preventDefault(); guardarPrecioManual(g.product_id); }} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                            <input autoFocus type="number" min={0} step="0.01" value={precioManual} onChange={(e) => setPrecioManual(Number(e.target.value))}
                              className="w-20 px-1.5 py-1 rounded text-xs outline-none" style={{ background: "#fff", border: "1px solid #D9D0C2" }} />
                            <button type="submit" disabled={guardandoPrecio} className="text-xs px-2 py-1 rounded" style={{ background: "#4F6F52", color: "#F7F3EC" }}>{guardandoPrecio ? "..." : "Guardar"}</button>
                          </form>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); setEditandoPrecio(g.product_id); setPrecioManual(Number((g.subtotalSinDescuento / g.cantidadTotal).toFixed(2))); }}
                            className="font-serif text-sm flex items-center gap-1" title="Editar precio unitario de este producto">
                            Bs {g.subtotalConDescuento.toFixed(2)} <Pencil size={11} />
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); quitarUnidad(g.detalle[g.detalle.length - 1].id); }} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} title="Quitar 1 unidad">
                          <Minus size={12} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); aumentarUnidad(g.product_id); }} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "#9C7A3C", color: "#F7F3EC" }} title="Agregar 1 unidad">
                          <Plus size={12} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); quitarProductoCompleto(g); }} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "#F4E3E6", color: "#7A2540" }} title="Quitar producto completo (Supr)">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "#5B4E5E" }}>
                      {g.detalle.length === 1
                        ? `${g.detalle[0].cantidad} unidad(es) — ${g.detalle[0].fecha}`
                        : resumenFechas(g)}
                      {g.descuento > 0 && ` · descuento aplicado: Bs ${g.descuento.toFixed(2)}`}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Subtotal sin descuento</span><span>Bs {subtotalSinDescuento.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#4F6F52" }}>Descuento por cantidad</span><span style={{ color: "#4F6F52" }}>− Bs {descuentoTotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm mb-1.5 pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>Total seleccionado</span><span className="font-serif">Bs {total.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Dinero disponible</span><span>Bs {depositado.toFixed(2)}</span></div>
              {saldoAFavor > 0 ? (
                <div className="flex justify-between text-sm pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#4F6F52" }}>Saldo a favor</span><span className="font-serif" style={{ color: "#4F6F52" }}>Bs {saldoAFavor.toFixed(2)}</span></div>
              ) : (
                <div className="flex justify-between text-sm pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#7A2540" }}>Saldo pendiente</span><span className="font-serif" style={{ color: "#7A2540" }}>Bs {saldoPendiente.toFixed(2)}</span></div>
              )}
            </div>

            {ordenId && (
              <div className="flex gap-2 mb-3 flex-wrap">
                <button onClick={() => setMostrarResumenCierre(true)} className="flex-1 py-2.5 rounded-md text-sm" style={{ background: "#2B1E2E", color: "#F7F3EC" }}>
                  Cerrar pedido
                </button>
                <button onClick={generarPdfAbierto} disabled={generandoPdf} className="flex-1 py-2.5 rounded-md text-sm flex items-center justify-center gap-2" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                  <FileDown size={15} /> {generandoPdf ? "Generando PDF..." : "PDF cliente / WhatsApp"}
                </button>
                <button onClick={() => setMostrarSelectorFecha((v) => !v)} disabled={fechasConAsignaciones.length === 0} className="py-2.5 px-3 rounded-md text-sm flex items-center gap-1.5" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                  <FileDown size={15} /> PDF por fecha
                </button>
                <button onClick={() => setMostrarRecibo(true)} className="py-2.5 px-3 rounded-md text-sm flex items-center justify-center gap-2" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} title="Ticket térmico 80 mm, sin imágenes">
                  <Printer size={15} />
                </button>
              </div>
            )}

            {mostrarSelectorFecha && (
              <div className="p-3 mb-3 rounded-md flex items-center gap-2 flex-wrap" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>Elige una fecha para generar el PDF solo de ese día:</p>
                {fechasConAsignaciones.map((f) => (
                  <button key={f} onClick={() => generarPdfPorFecha(f)} disabled={generandoPdf} className="text-xs px-3 py-1.5 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                    {f}
                  </button>
                ))}
              </div>
            )}

            {mostrarResumenCierre && (
              <div className="p-4 mb-3 rounded-md" style={{ background: "#F6EAD2", border: "1px solid #B7791F" }}>
                <p className="text-sm font-medium mb-2" style={{ color: "#7A5F2D" }}>Confirmar cierre de pedido</p>
                <div className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Total del pedido: Bs {total.toFixed(2)} (incluye Bs {descuentoTotal.toFixed(2)} de descuento)</div>
                <div className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Dinero disponible para este pedido: Bs {depositado.toFixed(2)}</div>
                {saldoAFavor > 0 ? <div className="text-xs mb-2" style={{ color: "#4F6F52" }}>Saldo a favor: Bs {saldoAFavor.toFixed(2)} — al cerrar se registrará automáticamente como dinero devuelto y la cuenta terminará en Bs 0.</div> : <div className="text-xs mb-2" style={{ color: "#7A2540" }}>Saldo pendiente: Bs {saldoPendiente.toFixed(2)} — al cerrar se registrará automáticamente como pagado y la cuenta terminará en Bs 0.</div>}
                <div className="flex gap-2">
                  <button onClick={confirmarCierre} disabled={cerrando} className="text-xs px-4 py-2 rounded-md"
                    style={{ background: "#2B1E2E", color: "#F7F3EC" }}>
                    {cerrando ? "Cerrando..." : "Confirmar y cerrar pedido"}
                  </button>
                  <button onClick={() => { setMostrarResumenCierre(false); setPendienteSobrante(false); }} className="text-xs px-4 py-2 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>Cancelar</button>
                </div>
              </div>
            )}

            {mostrarRecibo && (
              <div className="flex flex-col items-center mb-3">
                <div id="recibo-termico" style={{ background: "#fff", color: "#111", width: 302, fontFamily: "monospace" }} className="p-2 text-xs shadow-md">
                  <p className="text-center font-bold ticket-brand" style={{ fontSize: "1.08rem", fontFamily: "Georgia, Times New Roman, serif", fontStyle: "italic" }}>{nombreNegocio}</p>
                  {telefonoNegocio && <p className="text-center">CEL: {telefonoNegocio}</p>}
                  <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                  <p>Fecha: {new Date().toLocaleDateString("es-BO")}</p>
                  <p>Hora: {new Date().toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}</p>
                  <p>Responsable: {profile?.full_name || "No registrado"}</p>
                  <p>Rol: {profile?.role === "admin" ? "Administrador" : "Vendedor"}</p>
                  <p>Cliente: {seleccionado.name}</p>
                  {seleccionado.phone && <p>Teléfono: {seleccionado.phone}</p>}
                  <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                  <div className="flex justify-between font-bold"><span>CANT.  CÓDIGO  PRODUCTO</span><span>IMPORTE</span></div>
                  <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                  {grupos.map((g) => (
                    <div key={g.product_id}>
                      <div className="flex justify-between"><span>{g.cantidadTotal}  {g.codigo}  {g.nombre}</span><span>Bs {g.subtotalConDescuento.toFixed(2)}</span></div>
                      </div>
                  ))}
                  <div style={{ borderTop: "1px dashed #999" }} className="my-1" />
                  <div><span>N.º DE ARTÍCULOS: {grupos.reduce((a, g) => a + g.cantidadTotal, 0)}</span></div>
                  <div className="flex justify-between"><span>SUBTOTAL</span><span>Bs {subtotalSinDescuento.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>DESCUENTO</span><span>Bs {descuentoTotal.toFixed(2)}</span></div>
                  <div className="flex justify-between font-bold"><span>TOTAL</span><span>Bs {total.toFixed(2)}</span></div>
                  <p className="text-center" style={{ marginTop: 8 }}>GRACIAS POR SU COMPRA</p>
                  <p className="text-center font-bold ticket-brand" style={{ fontSize: "1rem", fontFamily: "Georgia, Times New Roman, serif", fontStyle: "italic" }}>{nombreNegocio}</p>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => imprimirTicket()} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                    <Printer size={13} /> Ticket térmico 80 mm
                  </button>
                  <button onClick={() => setMostrarRecibo(false)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>Cerrar</button>
                </div>
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
