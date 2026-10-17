import React, { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Mic, MicOff, Play, Search, Square, PackagePlus, Plus, Minus, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Product } from "../lib/types";

type ProductoLive = Pick<Product, "id" | "code" | "name" | "price" | "stock_available">;
type Accion = "add" | "remove" | "set";
type Modificacion = { customer_name: string; quantity: number; ring_size: string | null; action: Accion };
type ReservaLive = { id: string; product_id: string; product_code: string | null; dictated_customer_name: string | null; customer_name: string | null; quantity: number; ring_size: string | null; source?: string; status: string; created_at: string; modified_at?: string | null };
type LiveRow = { id: string; items: ReservaLive[] };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

function hhmmss(total: number) {
  const s = Math.max(0, Math.floor(total)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

function parsearDictado(raw: string, esAnillo: boolean, repetir: boolean): Modificacion[] {
  const texto = raw.replace(/^.*?\brepito\b[\s,:-]*/i, "").replace(/^(?:y\s+)?(?:vuelvo\s+a\s+dictar|otra\s+vez|corrijo)\s*/i, "").replace(/[.!?]/g, " ").replace(/\s+/g, " ").trim();
  const salida: Modificacion[] = [];
  const add = (customer_name: string, quantity: number, ring_size: string | null, action: Accion) => {
    customer_name = customer_name.trim().replace(/^(?:y|para|a)\s+/i, "").replace(/[,:;]+$/, "").trim();
    if (!customer_name || !Number.isInteger(quantity) || quantity < 0 || (quantity === 0 && action !== "set")) return;
    if (esAnillo && !ring_size) return;
    const key = `${customer_name.toLocaleLowerCase()}|${ring_size || ""}`;
    const index = salida.findIndex((row) => `${row.customer_name.toLocaleLowerCase()}|${row.ring_size || ""}` === key);
    const row = { customer_name, quantity, ring_size, action };
    if (index < 0) salida.push(row);
    else if ((action === "add" || action === "remove") && salida[index].action === action) salida[index] = { ...row, quantity: salida[index].quantity + quantity };
    else salida[index] = row;
  };
  const defaultAction: Accion = repetir ? "set" : "add";

  if (esAnillo) {
    let clienteActual = "";
    const segmentos = texto
      .replace(/\by\s+(?=\d+\s*(?:unidades?\s*)?(?:en|para)\b)/gi, ", ")
      .replace(/\ben\s+en\s+/gi, " en ").split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
    for (const segmento of segmentos) {
      const quitar = segmento.match(/^(?:quitar|quita|retirar|retira|restar|resta|sacar|saca)\s+(\d+)\s*(?:unidades?\s*)?(?:en\s*)?(?:la\s*)?talla\s*(\d+(?:\.\d+)?)(?:\s+(?:a|de|para)\s+([\p{L}][\p{L}' -]{0,35}))?$/iu);
      if (quitar) { clienteActual = quitar[3]?.trim() || clienteActual; add(clienteActual, Number(quitar[1]), quitar[2], "remove"); continue; }
      const nombreYSizes = segmento.match(/^([\p{L}][\p{L}' -]{0,35}?)\s+(\d+(?:\s+y\s+\d+|\s*,\s*\d+)*)$/iu);
      if (nombreYSizes) {
        clienteActual = nombreYSizes[1].trim();
        for (const size of nombreYSizes[2].matchAll(/\d+(?:\.\d+)?/g)) add(clienteActual, 1, size[0], defaultAction);
        continue;
      }
      if (/^[\p{L}][\p{L}' -]{0,35}$/u.test(segmento)) { clienteActual = segmento; continue; }
      if (/^\d+(?:\.\d+)?$/.test(segmento) && clienteActual) { add(clienteActual, 1, segmento, defaultAction); continue; }
      const namedReversed = segmento.match(/^(\d+)\s*(?:unidades?\s*)?(?:para|de)\s+([\p{L}][\p{L}' -]{0,35}?)\s+(?:la\s*)?talla\s*(\d+(?:\.\d+)?)$/iu);
      if (namedReversed) { clienteActual = namedReversed[2].trim(); add(clienteActual, Number(namedReversed[1]), namedReversed[3], defaultAction); continue; }
      const named = segmento.match(/^([\p{L}][\p{L}' -]{0,35}?)\s+(\d+)\s*(?:unidades?\s*)?(?:en\s*)?(?:la\s*)?(?:talla\s*)?(\d+(?:\.\d+)?)(?:\s*(?:para|de)\s*([\p{L}][\p{L}' -]{0,35}))?$/iu);
      const reversed = segmento.match(/^(\d+)\s*(?:unidades?\s*)?(?:en\s*)?(?:la\s*)?(?:talla\s*)?(\d+(?:\.\d+)?)(?:\s*(?:para|de)\s*([\p{L}][\p{L}' -]{0,35}))?$/iu);
      if (named) { clienteActual = named[4]?.trim() || named[1].trim(); add(clienteActual, Number(named[2]), named[3], defaultAction); continue; }
      if (reversed) { clienteActual = reversed[3]?.trim() || clienteActual; add(clienteActual, Number(reversed[1]), reversed[2], defaultAction); }
    }
  } else {
    const removeRx = /(?:^|[,;]\s*|\by\s+)(?:quitar|quita|retirar|retira|restar|resta|sacar|saca)\s+(\d+)\s*(?:unidades?\s*)?(?:a|de|para)\s+([\p{L}][\p{L}' -]{0,35}?)(?=$|[,;]|\s+y\s+(?:quitar|restar|\d+\s+(?:para|de)))/giu;
    for (const m of texto.matchAll(removeRx)) add(m[2], Number(m[1]), null, "remove");
    const setRx = /(?:^|[,;]\s*|\by\s+)(?:dejar|deja|reducir|reduce|cambiar|cambia|corregir|corrige)\s+(?:a\s+)?([\p{L}][\p{L}' -]{0,35}?)\s+(?:en\s+)?(\d+)(?:\s*unidades?)?(?=$|[,;])/giu;
    for (const m of texto.matchAll(setRx)) add(m[1], Number(m[2]), null, "set");
    const addRx = /(?:^|[,;]\s*|\by\s+)(\d+)\s*(?:unidades?\s*)?(?:para|de)\s+([\p{L}][\p{L}' -]{0,35}?)(?=$|[,;]|\s+y\s+\d+\s*(?:unidades?\s*)?(?:para|de)\s+)/giu;
    for (const m of texto.matchAll(addRx)) add(m[2], Number(m[1]), null, defaultAction);
  }
  return salida;
}

function fechaHora(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/La_Paz" }).format(new Date(value));
}

function normalizarCodigoDictado(transcripcion: string) {
  const texto = transcripcion.toLocaleLowerCase().replace(/^(?:c[oó]digo|n[uú]mero|item|ítem)\s+/i, "").trim();
  const directo = texto.replace(/[^\p{L}\p{N}-]/gu, "").toUpperCase();
  if (/^[\p{L}\p{N}-]+$/u.test(directo) && /\d/u.test(directo)) return directo;
  const palabras = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((x) => x && x !== "y");
  const digitos: Record<string, string> = { cero: "0", un: "1", uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9" };
  if (palabras.length && palabras.every((word) => word in digitos)) return palabras.map((word) => digitos[word]).join("");
  const valores: Record<string, number> = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };
  if (!palabras.length || palabras.some((word) => !(word in valores) && word !== "mil")) return directo;
  let total = 0; let actual = 0;
  for (const word of palabras) {
    if (word === "mil") { total += (actual || 1) * 1000; actual = 0; }
    else actual += valores[word];
  }
  const numero = total + actual;
  return numero > 0 ? `${palabras[0] === "cero" && palabras.length > 1 ? "0" : ""}${numero}` : directo;
}

export default function Live() {
  const [liveId, setLiveId] = useState<string | null>(null); const [inicioLocal, setInicioLocal] = useState<number | null>(null); const [segundos, setSegundos] = useState(0);
  const [busqueda, setBusqueda] = useState(""); const [productos, setProductos] = useState<ProductoLive[]>([]); const [producto, setProducto] = useState<ProductoLive | null>(null);
  const [eventoId, setEventoId] = useState<string | null>(null); const [eventoHora, setEventoHora] = useState(""); const [eventoElapsed, setEventoElapsed] = useState(0); const [catalogoId, setCatalogoId] = useState<string | null>(null); const [catalogoDisponible, setCatalogoDisponible] = useState<number | null>(null); const [esAnillo, setEsAnillo] = useState(false);
  const [dictado, setDictado] = useState(""); const [modificaciones, setModificaciones] = useState<Modificacion[]>([]); const [repetir, setRepetir] = useState(false);
  const [reservasActuales, setReservasActuales] = useState<ReservaLive[]>([]); const [procesando, setProcesando] = useState(false); const [mensaje, setMensaje] = useState(""); const [escuchando, setEscuchando] = useState(false);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  const activo = useMemo(() => Boolean(liveId), [liveId]);

  useEffect(() => {
    if (!inicioLocal) return;
    const actualizar = () => setSegundos(Math.floor((Date.now() - inicioLocal) / 1000)); actualizar();
    const id = window.setInterval(actualizar, 1000); return () => window.clearInterval(id);
  }, [inicioLocal]);
  useEffect(() => () => recognizerRef.current?.stop(), []);
  useEffect(() => {
    const q = busqueda.trim(); if (!q) { setProductos([]); return; }
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.from("products").select("id,code,name,price,stock_available").is("deleted_at", null).eq("active", true).or(`code.ilike.%${q}%,name.ilike.%${q}%`).order("code").limit(12);
      setProductos((data as ProductoLive[]) ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [busqueda]);

  async function cargarReservas(productId: string) {
    if (!liveId) return;
    const { data, error } = await supabase.rpc("get_live_orders_v2", { p_live_date: null });
    if (error) { setMensaje(error.message); return; }
    const sessions = (Array.isArray(data) ? data : []) as LiveRow[];
    const current = sessions.find((row) => row.id === liveId);
    setReservasActuales((current?.items || []).filter((row) => row.product_id === productId && row.status === "pending"));
  }
  async function iniciarLive() {
    setProcesando(true); setMensaje(""); const { data, error } = await supabase.rpc("start_live_session", { p_notes: null }); setProcesando(false);
    if (error) { setMensaje(error.message); return; }
    setLiveId(data as string); setInicioLocal(Date.now()); setSegundos(0); setMensaje("Live iniciado. Identifica un código para registrar pedidos.");
  }
  async function finalizarLive() {
    if (!liveId || !window.confirm("¿Finalizar este Live? Las preasignaciones seguirán reservadas para repartirlas después.")) return;
    setProcesando(true); const { error } = await supabase.rpc("finish_live_session", { p_live_session_id: liveId }); setProcesando(false);
    if (error) { setMensaje(error.message); return; }
    setLiveId(null); setInicioLocal(null); setSegundos(0); setProducto(null); setEventoId(null); setReservasActuales([]); setMensaje("Live finalizado. El registro quedó guardado por fecha.");
  }
  async function seleccionarProducto(p: ProductoLive) {
    if (!liveId) return;
    setProcesando(true); setMensaje(""); setDictado(""); setModificaciones([]); setReservasActuales([]);
    const { data: catalogo, error: catError } = await supabase.from("catalog_products").select("id,stock_available,active,variant_type").eq("product_id", p.id).eq("active", true).order("stock_available", { ascending: false }).limit(1).maybeSingle();
    if (catError) { setProcesando(false); setMensaje(`No se pudo comprobar el catálogo: ${catError.message}`); return; }
    const { data, error } = await supabase.rpc("live_get_or_create_product_event", { p_live_session_id: liveId, p_product_id: p.id });
    setProcesando(false);
    if (error) { setMensaje(error.message); return; }
    const event = data as { id: string; shown_at: string; elapsed_seconds: number };
    setProducto(p); setEventoId(event.id); setEventoHora(event.shown_at); setEventoElapsed(event.elapsed_seconds || 0); setBusqueda(""); setProductos([]);
    setCatalogoId(catalogo?.id || null); setCatalogoDisponible(catalogo ? Number(catalogo.stock_available) : null); setEsAnillo(catalogo?.variant_type === "ring_size" || /anill/i.test(p.name));
    await cargarReservas(p.id);
    setMensaje(`Código ${p.code} identificado. Registro mostrado: ${fechaHora(event.shown_at)}${event.elapsed_seconds ? ` · ${hhmmss(event.elapsed_seconds)} del Live` : ""}.`);
  }
  async function reconocerCodigo() {
    const Speech = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!Speech) { setMensaje("Este navegador no ofrece reconocimiento de voz. Escribe el código para buscarlo."); return; }
    const recognition = new Speech(); recognition.lang = "es-BO"; recognition.interimResults = false;
    recognition.onresult = async (event) => {
      const code = normalizarCodigoDictado(String(event.results?.[0]?.[0]?.transcript || ""));
      if (!code) { setMensaje("No pude reconocer el código. Intenta de nuevo o escríbelo."); return; }
      setBusqueda(code);
      const { data, error } = await supabase.from("products").select("id,code,name,price,stock_available").is("deleted_at", null).eq("active", true).ilike("code", code).limit(2);
      if (error) { setMensaje(error.message); return; }
      if (data?.length === 1) await seleccionarProducto(data[0] as ProductoLive);
      else if (!data?.length) setMensaje(`No encontré el código ${code}. Revisa e inténtalo otra vez.`);
      else setMensaje(`Hay más de un artículo con código ${code}; elige el correcto de la lista.`);
    };
    recognition.onerror = (event) => setMensaje(`No se reconoció el código (${event.error || "error"}). Puedes escribirlo.`);
    recognizerRef.current = recognition; recognition.start();
  }
  function dictarPedido() {
    const Speech = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!Speech) { setMensaje("Este navegador no ofrece reconocimiento de voz. Puedes escribir el pedido aquí."); return; }
    if (escuchando) { recognizerRef.current?.stop(); setEscuchando(false); return; }
    const recognition = new Speech(); recognition.lang = "es-BO"; recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results as ArrayLike<any>).map((r: any) => r[0]?.transcript || "").join(" ").trim();
      if (/\brepito\b/i.test(text)) {
        const replacement = text.replace(/^.*?\brepito\b[\s,:-]*/i, "").replace(/^(?:y\s+)?(?:vuelvo\s+a\s+dictar|otra\s+vez|corrijo)\s*/i, "").trim();
        setDictado(replacement); setModificaciones([]); setRepetir(true);
        setMensaje(replacement ? "Repetición recibida. Para los nombres y tallas mencionados, indicaré cantidades finales para corregir lo anterior." : "Dictado anterior conservado; vuelve a dictar el nombre para fijar su cantidad correcta.");
      } else setDictado((old) => `${old} ${text}`.trim());
    };
    recognition.onerror = (event) => setMensaje(`No se pudo reconocer la voz (${event.error || "error"}). Puedes corregir el texto.`);
    recognition.onend = () => setEscuchando(false); recognizerRef.current = recognition; recognition.start(); setEscuchando(true);
  }
  function revisarDictado() {
    if (!eventoId || !producto) { setMensaje("Selecciona el código del artículo primero."); return; }
    const parsed = parsearDictado(dictado, esAnillo, repetir);
    if (!parsed.length) { setMensaje(esAnillo ? "No encontré cantidades, clientas y tallas. Ej.: «Claudia 6, 7, 2 unidades en 8, 2 en 9 y 1 en 10»." : "No encontré cantidades y nombres. Ej.: «2 para María, 1 para José»; para quitar: «quitar 1 a María». "); return; }
    setModificaciones(parsed); setMensaje(`Revisa ${parsed.length} cambio(s). Aún no se ha reservado ni descontado stock.`);
  }
  async function aplicarDictado() {
    if (!liveId || !eventoId || !producto || !modificaciones.length) return;
    setProcesando(true); setMensaje("");
    const { error } = await supabase.rpc("live_apply_voice_allocations", { p_live_session_id: liveId, p_live_product_event_id: eventoId, p_product_id: producto.id, p_catalog_product_id: catalogoId, p_allocations: modificaciones });
    setProcesando(false);
    if (error) { setMensaje(error.message); return; }
    const resumen = modificaciones.map((x) => `${x.customer_name}: ${x.action === "add" ? "+" : x.action === "remove" ? "−" : "="}${x.quantity}${x.ring_size ? ` talla ${x.ring_size}` : ""}`).join(" · ");
    setMensaje(`Cambios guardados para ${producto.code}: ${resumen}. Reserva actualizada en ${catalogoId ? "stock y catálogo" : "stock"}.`);
    setDictado(""); setModificaciones([]); setRepetir(false);
    const { data: updated } = await supabase.from("products").select("id,code,name,price,stock_available").eq("id", producto.id).maybeSingle();
    if (updated) setProducto(updated as ProductoLive);
    if (catalogoId) { const { data: cp } = await supabase.from("catalog_products").select("stock_available").eq("id", catalogoId).maybeSingle(); if (cp) setCatalogoDisponible(Number(cp.stock_available)); }
    await cargarReservas(producto.id);
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-[#54263b]">🔴 Live</h1><p className="text-sm text-[#6f5962]">Pedidos por código, fecha y hora; sin capturas de imagen.</p></div>
      {!activo ? <button disabled={procesando} onClick={iniciarLive} className="flex items-center gap-2 rounded-lg bg-[#7A2540] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Play size={17} /> Iniciar Live</button> : <div className="flex items-center gap-3"><div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 font-mono text-lg font-bold text-[#54263b] shadow-sm"><Clock3 size={18} /> {hhmmss(segundos)}</div><button disabled={procesando} onClick={finalizarLive} className="flex items-center gap-2 rounded-lg bg-[#2B1E2E] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Square size={16} /> Finalizar Live</button></div>}
    </div>
    {mensaje && <div className="rounded-lg border border-[#dfcbd2] bg-white px-4 py-3 text-sm text-[#54263b]">{mensaje}</div>}
    {!activo ? <div className="rounded-xl border border-[#dfcbd2] bg-white p-8 text-center text-sm text-[#6f5962]">Presiona <strong>Iniciar Live</strong> para comenzar a registrar códigos y pedidos.</div> : <>
      <div className="rounded-xl border border-[#dfcbd2] bg-white p-4 shadow-sm"><label className="mb-2 block text-sm font-semibold text-[#54263b]">Buscar artículo por código o nombre</label><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-3 text-[#8d6d78]" size={18} /><input autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && productos[0]) { e.preventDefault(); void seleccionarProducto(productos[0]); } }} placeholder="Ej.: 3540" className="w-full rounded-lg border border-[#d8c6cc] py-2.5 pl-10 pr-3 outline-none focus:border-[#8d465f]" /></div><button onClick={() => void reconocerCodigo()} className="flex shrink-0 items-center gap-2 rounded-lg bg-[#7A2540] px-3 py-2 text-sm font-semibold text-white"><Mic size={16} /> Código</button></div>
        {productos.length > 0 && <div className="mt-2 divide-y overflow-hidden rounded-lg border">{productos.map((p) => <button key={p.id} onClick={() => void seleccionarProducto(p)} className="flex w-full items-center gap-3 bg-white p-3 text-left hover:bg-[#fff7f9]"><div className="flex h-12 w-12 items-center justify-center rounded-md bg-[#f5e9ed] text-xs font-bold text-[#7a2540]"><Search size={18} /></div><div className="min-w-0 flex-1"><div className="font-semibold text-[#54263b]">{p.code} · {p.name}</div><div className="text-xs text-gray-500">Disponible: {p.stock_available} · {Number(p.price).toFixed(2)} Bs</div></div></button>)}</div>}
      </div>
      {producto && eventoId && <div className="rounded-xl border border-[#dfcbd2] bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-xl font-bold text-[#54263b]">Ítem {producto.code} · {producto.name}</div><div className="mt-1 text-sm text-[#6f5962]">Mostrado: {fechaHora(eventoHora)} · minuto {hhmmss(eventoElapsed)} del Live</div><div className="mt-1 text-sm font-semibold text-[#54263b]">Stock libre: {producto.stock_available}{catalogoId && catalogoDisponible !== null ? ` · Catálogo libre: ${catalogoDisponible}` : ""}</div><p className="mt-1 text-xs text-[#6f5962]">Si vuelves a seleccionar este código, se abre el mismo ítem y se actualiza su lista, sin duplicar su fecha/hora.</p></div></div>
        <div className="mt-4 rounded-lg bg-[#fff7f9] p-3"><div className="mb-2 font-semibold text-[#54263b]">Preasignaciones activas para este ítem</div>{reservasActuales.length ? <div className="divide-y divide-[#ead8de]">{reservasActuales.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><strong>{r.customer_name || r.dictated_customer_name || "Sin nombre"}</strong>{r.ring_size ? ` · talla ${r.ring_size}` : ""}<span className="block text-xs text-[#806270]">Pedido: {fechaHora(r.created_at)}{r.modified_at ? ` · Ajustado: ${fechaHora(r.modified_at)}` : ""}</span></span><span>{r.quantity} unidad(es) · {r.source === "catalogo" ? "catálogo" : "stock"}</span></div>)}</div> : <div className="text-sm text-[#806270]">Todavía no hay cantidades reservadas para este código.</div>}</div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-[#54263b]">Dictar cambios</h2><p className="text-xs text-[#6f5962]">Agregar: «2 para María». Reducir o quitar: «quitar 1 a María». Corregir total: «dejar María en 1».</p>{esAnillo && <p className="text-xs text-[#6f5962]">Anillos: «Claudia 6, 7, 2 unidades en 8, 2 en 9 y 1 en 10».</p>}</div><button onClick={dictarPedido} className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold ${escuchando ? "bg-red-700 text-white" : "bg-[#7A2540] text-white"}`}>{escuchando ? <MicOff size={17} /> : <Mic size={17} />}{escuchando ? "Detener dictado" : "Dictar cambios"}</button></div>
        <textarea value={dictado} onChange={(e) => setDictado(e.target.value)} rows={3} placeholder="Dicta un pedido o una corrección; confirma la vista previa antes de guardar." className="mt-3 w-full rounded-lg border border-[#d8c6cc] px-3 py-2.5 text-sm" /><div className="mt-2 flex flex-wrap gap-2"><button onClick={() => { setDictado(""); setModificaciones([]); setRepetir(true); setMensaje("Modo corrección: las cantidades dictadas se tomarán como cantidades finales para esos nombres/tallas."); }} className="rounded-lg border border-[#b995a2] px-4 py-2 text-sm text-[#54263b]">Repito / corregir</button><button onClick={revisarDictado} className="rounded-lg border border-[#b995a2] px-4 py-2 text-sm font-semibold text-[#54263b]">Revisar cambios</button></div>
        {modificaciones.length > 0 && <div className="mt-4 space-y-2"><div className="text-xs font-semibold text-[#6d2943]">Vista previa editable · todavía sin descontar</div>{modificaciones.map((a, i) => <div key={`${a.customer_name}-${a.ring_size}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:grid-cols-[minmax(0,1fr)_100px_120px_auto_auto]"><input value={a.customer_name} onChange={(e) => setModificaciones((rows) => rows.map((x, n) => n === i ? { ...x, customer_name: e.target.value } : x))} aria-label="Nombre de clienta" className="min-w-0 rounded-lg border px-2 py-2 text-sm" /><select value={a.action} onChange={(e) => setModificaciones((rows) => rows.map((x, n) => n === i ? { ...x, action: e.target.value as Accion } : x))} aria-label="Acción" className="rounded-lg border px-2 py-2 text-sm"><option value="add">Sumar</option><option value="remove">Quitar</option><option value="set">Dejar en</option></select><input type="number" min={a.action === "set" ? 0 : 1} value={a.quantity} onChange={(e) => setModificaciones((rows) => rows.map((x, n) => n === i ? { ...x, quantity: Math.max(x.action === "set" ? 0 : 1, Number(e.target.value) || 0) } : x))} aria-label="Cantidad" className="rounded-lg border px-2 py-2 text-sm" />{esAnillo ? <input value={a.ring_size || ""} onChange={(e) => setModificaciones((rows) => rows.map((x, n) => n === i ? { ...x, ring_size: e.target.value || null } : x))} aria-label="Talla" placeholder="Talla" className="rounded-lg border px-2 py-2 text-sm" /> : <span />}{a.action === "add" ? <Plus size={16} className="text-green-700" /> : a.action === "remove" ? <Minus size={16} className="text-red-700" /> : <button onClick={() => setModificaciones((rows) => rows.filter((_, n) => n !== i))} aria-label="Quitar línea" className="rounded-md p-1 text-red-700"><X size={16} /></button>}</div>)}<button disabled={procesando || !modificaciones.length} onClick={() => void aplicarDictado()} className="mt-2 flex items-center gap-2 rounded-lg bg-[#7A2540] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><PackagePlus size={17} /> Guardar cambios y actualizar reservas</button></div>}
      </div>}
    </>}
  </div>;
}
