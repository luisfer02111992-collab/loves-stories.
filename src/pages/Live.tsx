import React, { useEffect, useMemo, useState } from "react";
import { Clock3, Play, Search, Square, PackagePlus, Hourglass } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Product } from "../lib/types";

type ProductoLive = Pick<Product, "id" | "code" | "name" | "price" | "stock_available" | "image_url">;

function hhmmss(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export default function Live() {
  const [liveId, setLiveId] = useState<string | null>(null);
  const [inicioLocal, setInicioLocal] = useState<number | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState<ProductoLive[]>([]);
  const [producto, setProducto] = useState<ProductoLive | null>(null);
  const [eventoId, setEventoId] = useState<string | null>(null);
  const [cliente, setCliente] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [talla, setTalla] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    if (!inicioLocal) return;
    const actualizar = () => setSegundos(Math.floor((Date.now() - inicioLocal) / 1000));
    actualizar();
    const id = window.setInterval(actualizar, 1000);
    return () => window.clearInterval(id);
  }, [inicioLocal]);

  useEffect(() => {
    const q = busqueda.trim();
    if (!q) {
      setProductos([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from("products")
        .select("id,code,name,price,stock_available,image_url")
        .is("deleted_at", null)
        .eq("active", true)
        .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
        .order("code")
        .limit(12);
      setProductos((data as ProductoLive[]) ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [busqueda]);

  const activo = useMemo(() => Boolean(liveId), [liveId]);

  async function iniciarLive() {
    setProcesando(true);
    setMensaje("");
    const { data, error } = await supabase.rpc("start_live_session", { p_notes: null });
    setProcesando(false);
    if (error) {
      setMensaje(error.message);
      return;
    }
    setLiveId(data as string);
    setInicioLocal(Date.now());
    setSegundos(0);
    setMensaje("Live iniciado correctamente.");
  }

  async function finalizarLive() {
    if (!liveId) return;
    if (!window.confirm("¿Finalizar este Live? Las preasignaciones seguirán reservadas para repartirlas después.")) return;
    setProcesando(true);
    const { error } = await supabase.rpc("finish_live_session", { p_live_session_id: liveId });
    setProcesando(false);
    if (error) {
      setMensaje(error.message);
      return;
    }
    setLiveId(null);
    setInicioLocal(null);
    setSegundos(0);
    setProducto(null);
    setEventoId(null);
    setMensaje("Live finalizado. Las reservas quedaron guardadas.");
  }

  async function mostrarProducto(p: ProductoLive) {
    if (!liveId) return;
    setProcesando(true);
    setMensaje("");
    const { data, error } = await supabase.rpc("live_show_product", {
      p_live_session_id: liveId,
      p_product_id: p.id,
      p_live_image_url: null,
    });
    setProcesando(false);
    if (error) {
      setMensaje(error.message);
      return;
    }
    setProducto(p);
    setEventoId(data as string);
    setBusqueda("");
    setProductos([]);
    setCliente("");
    setCantidad(1);
    setTalla("");
    setMensaje(`Producto ${p.code} registrado en ${hhmmss(segundos)}.`);
  }

  async function guardar(tipo: "pending" | "waiting") {
    if (!liveId || !eventoId || !producto) return;
    if (!cliente.trim()) {
      setMensaje("Escribe el nombre de la clienta.");
      return;
    }
    setProcesando(true);
    setMensaje("");

    const rpc = tipo === "pending" ? "live_preassign_product" : "live_add_waiting";
    const params: Record<string, unknown> = {
      p_live_session_id: liveId,
      p_live_product_event_id: eventoId,
      p_product_id: producto.id,
      p_customer_id: null,
      p_dictated_customer_name: cliente.trim(),
      p_quantity: cantidad,
    };
    if (tipo === "pending") params.p_ring_size = talla.trim() || null;

    const { error } = await supabase.rpc(rpc, params);
    setProcesando(false);
    if (error) {
      setMensaje(error.message);
      return;
    }

    if (tipo === "pending") {
      setProducto((prev) => prev ? { ...prev, stock_available: Math.max(0, prev.stock_available - cantidad) } : prev);
      setMensaje(`${cliente.trim()} · ${cantidad} unidad(es) preasignada(s).`);
    } else {
      setMensaje(`${cliente.trim()} quedó en lista de espera.`);
    }
    setCliente("");
    setCantidad(1);
    setTalla("");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#54263b]">🔴 Live</h1>
          <p className="text-sm text-[#6f5962]">Preasignación manual durante la transmisión.</p>
        </div>
        {!activo ? (
          <button disabled={procesando} onClick={iniciarLive} className="flex items-center gap-2 rounded-lg bg-[#7A2540] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            <Play size={17} /> Iniciar Live
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 font-mono text-lg font-bold text-[#54263b] shadow-sm">
              <Clock3 size={18} /> {hhmmss(segundos)}
            </div>
            <button disabled={procesando} onClick={finalizarLive} className="flex items-center gap-2 rounded-lg bg-[#2B1E2E] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Square size={16} /> Finalizar Live
            </button>
          </div>
        )}
      </div>

      {mensaje && <div className="rounded-lg border border-[#dfcbd2] bg-white px-4 py-3 text-sm text-[#54263b]">{mensaje}</div>}

      {!activo ? (
        <div className="rounded-xl border border-[#dfcbd2] bg-white p-8 text-center text-sm text-[#6f5962]">
          Presiona <strong>Iniciar Live</strong> para comenzar a registrar productos y clientas.
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-[#dfcbd2] bg-white p-4 shadow-sm">
            <label className="mb-2 block text-sm font-semibold text-[#54263b]">Buscar producto por código o nombre</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 text-[#8d6d78]" size={18} />
              <input autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej.: 025" className="w-full rounded-lg border border-[#d8c6cc] py-2.5 pl-10 pr-3 outline-none focus:border-[#8d465f]" />
            </div>
            {productos.length > 0 && (
              <div className="mt-2 divide-y overflow-hidden rounded-lg border">
                {productos.map((p) => (
                  <button key={p.id} onClick={() => mostrarProducto(p)} className="flex w-full items-center gap-3 bg-white p-3 text-left hover:bg-[#fff7f9]">
                    {p.image_url ? <img src={p.image_url} className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 rounded-md bg-[#eee5e8]" />}
                    <div className="min-w-0 flex-1"><div className="font-semibold text-[#54263b]">{p.code} · {p.name}</div><div className="text-xs text-gray-500">Disponible: {p.stock_available} · {Number(p.price).toFixed(2)} Bs</div></div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {producto && eventoId && (
            <div className="rounded-xl border border-[#dfcbd2] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap gap-4">
                {producto.image_url ? <img src={producto.image_url} className="h-28 w-28 rounded-lg object-cover" /> : <div className="h-28 w-28 rounded-lg bg-[#eee5e8]" />}
                <div className="flex-1">
                  <div className="text-xl font-bold text-[#54263b]">{producto.code}</div>
                  <div className="text-sm text-gray-600">{producto.name}</div>
                  <div className="mt-1 text-sm font-semibold">Disponible ahora: {producto.stock_available}</div>
                  <div className="text-xs text-gray-500">Aparición registrada en {hhmmss(segundos)}</div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold">Nombre dicho en el Live</label>
                  <input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Ej.: María" className="w-full rounded-lg border border-[#d8c6cc] px-3 py-2.5" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Cantidad</label>
                  <input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded-lg border border-[#d8c6cc] px-3 py-2.5" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Talla (solo si corresponde)</label>
                  <input value={talla} onChange={(e) => setTalla(e.target.value)} placeholder="Ej.: 7" className="w-full rounded-lg border border-[#d8c6cc] px-3 py-2.5" />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={procesando} onClick={() => guardar("pending")} className="flex items-center gap-2 rounded-lg bg-[#7A2540] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><PackagePlus size={17} /> Preasignar</button>
                <button disabled={procesando} onClick={() => guardar("waiting")} className="flex items-center gap-2 rounded-lg border border-[#b995a2] bg-white px-4 py-2.5 text-sm font-semibold text-[#54263b] disabled:opacity-50"><Hourglass size={17} /> Lista de espera</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
