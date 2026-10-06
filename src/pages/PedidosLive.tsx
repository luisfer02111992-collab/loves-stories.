import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock3, PackageCheck, RefreshCw, Users } from "lucide-react";
import { supabase } from "../lib/supabase";

type LiveItem = {
  id: string;
  product_id: string;
  product_code: string | null;
  product_name: string | null;
  product_image_url: string | null;
  live_image_url: string | null;
  dictated_customer_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  quantity: number;
  ring_size: string | null;
  status: "pending" | "assigned" | "rejected" | "waiting";
  created_at: string;
  shown_at: string;
  elapsed_seconds: number;
  price: number | null;
};

type LiveOrder = {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: "active" | "finished" | "distributed";
  notes: string | null;
  pending_count: number;
  waiting_count: number;
  items: LiveItem[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-BO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatElapsed(total: number | null | undefined) {
  const n = Math.max(0, Number(total || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function statusLabel(status: LiveOrder["status"]) {
  if (status === "active") return "EN VIVO";
  if (status === "distributed") return "DISTRIBUIDO";
  return "FINALIZADO";
}

function itemStatusLabel(status: LiveItem["status"]) {
  if (status === "assigned") return "Asignado";
  if (status === "rejected") return "Rechazado";
  if (status === "waiting") return "En espera";
  return "Pendiente";
}

export default function PedidosLive() {
  const [lives, setLives] = useState<LiveOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function loadLives() {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("get_live_orders");
    if (rpcError) {
      setError(rpcError.message || "No se pudieron cargar los Pedidos Live.");
      setLives([]);
    } else {
      const rows = (Array.isArray(data) ? data : []) as LiveOrder[];
      setLives(rows);
      if (!openId && rows.length > 0) setOpenId(rows[0].id);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadLives();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lives;
    return lives.filter((live) =>
      live.items.some((item) =>
        [item.product_code, item.product_name, item.dictated_customer_name, item.customer_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
    );
  }, [lives, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PackageCheck size={25} className="text-rose-800" />
            <h1 className="text-2xl font-bold text-[#54263b]">Pedidos Live</h1>
          </div>
          <p className="text-sm text-[#7a5362] mt-1">Lives guardados y solicitudes registradas durante cada transmisión.</p>
        </div>
        <button onClick={loadLives} disabled={loading} className="flex items-center gap-2 rounded-lg border border-[#cda7b4] bg-white px-3 py-2 text-sm text-[#6d2943] disabled:opacity-50">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Actualizar
        </button>
      </div>

      <div className="rounded-xl border border-[#e3cbd3] bg-white p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código, producto o nombre dicho en el Live…"
          className="w-full rounded-lg border border-[#d6aebc] px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9b365c]/20"
        />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && <div className="rounded-xl border border-[#ead8de] bg-white p-6 text-center text-sm text-[#7a5362]">Cargando Pedidos Live…</div>}
      {!loading && !error && filtered.length === 0 && <div className="rounded-xl border border-[#ead8de] bg-white p-8 text-center text-sm text-[#7a5362]">No hay Lives para mostrar.</div>}

      {!loading && filtered.map((live) => {
        const open = openId === live.id;
        const totalUnits = live.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        return (
          <div key={live.id} className="overflow-hidden rounded-xl border border-[#dfc4ce] bg-white shadow-sm">
            <button onClick={() => setOpenId(open ? null : live.id)} className="w-full p-4 text-left hover:bg-[#fff8fa]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#54263b]">Live · {formatDate(live.started_at)}</span>
                    <span className="rounded-full bg-[#f3dce5] px-2.5 py-1 text-[11px] font-bold text-[#7a2548]">{statusLabel(live.status)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#775766]">
                    <span className="flex items-center gap-1"><Users size={13} /> {live.items.length} solicitudes</span>
                    <span>{totalUnits} unidades</span>
                    <span className="font-semibold text-[#8a244d]">{live.pending_count} pendientes</span>
                    {live.waiting_count > 0 && <span>{live.waiting_count} en espera</span>}
                  </div>
                </div>
                {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </div>
            </button>

            {open && (
              <div className="border-t border-[#ead8de] p-4">
                {live.items.length === 0 ? (
                  <div className="py-5 text-center text-sm text-[#806270]">Este Live no tuvo solicitudes.</div>
                ) : (
                  <div className="space-y-3">
                    {live.items.map((item) => {
                      const image = item.live_image_url || item.product_image_url;
                      return (
                        <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-[#ead8de] bg-[#fffafb] p-3 md:flex-row md:items-center">
                          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#eee5e8]">
                            {image ? <img src={image} alt={item.product_code || "Producto"} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[11px] text-[#987985]">Sin foto</div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-[#54263b]">{item.product_code || "Sin código"}</strong>
                              <span className="text-sm text-[#765562]">{item.product_name || "Producto"}</span>
                              <span className="rounded-full border border-[#dcb8c5] bg-white px-2 py-0.5 text-[11px] text-[#7a2947]">{itemStatusLabel(item.status)}</span>
                            </div>
                            <div className="mt-1 text-sm text-[#54263b]">
                              <strong>{item.customer_name || item.dictated_customer_name || "Sin nombre"}</strong>
                              <span className="ml-2">· {item.quantity} unidad{Number(item.quantity) === 1 ? "" : "es"}</span>
                              {item.ring_size && <span className="ml-2">· Talla {item.ring_size}</span>}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[#806270]">
                              <span className="flex items-center gap-1"><Clock3 size={12} /> Video {formatElapsed(item.elapsed_seconds)}</span>
                              <span>Mostrado: {formatDate(item.shown_at)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
