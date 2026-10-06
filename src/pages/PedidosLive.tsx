import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronUp, Clock3, PackageCheck, RefreshCw,
  Users, Search, CheckCircle2, XCircle, Save, Hourglass
} from "lucide-react";
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

type Customer = {
  id: string;
  name: string;
  phone: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-BO", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [newQuantity, setNewQuantity] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function loadCustomers() {
    const { data } = await supabase
      .from("customers")
      .select("id,name,phone")
      .is("deleted_at", null)
      .order("name");
    setCustomers((data ?? []) as Customer[]);
  }

  useEffect(() => {
    loadLives();
    loadCustomers();
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

  const customerMatches = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);
    return customers
      .filter((c) => `${c.name} ${c.phone ?? ""}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [customers, customerSearch]);

  function beginEdit(item: LiveItem) {
    setEditingId(item.id);
    setCustomerSearch(item.customer_name || item.dictated_customer_name || "");
    setSelectedCustomerId(item.customer_id || "");
    setNewQuantity(Number(item.quantity || 1));
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setCustomerSearch("");
    setSelectedCustomerId("");
  }

  async function linkCustomer(item: LiveItem) {
    if (!selectedCustomerId) throw new Error("Selecciona una clienta.");
    if (item.customer_id === selectedCustomerId) return;
    const { error } = await supabase.rpc("link_live_preassignment_customer", {
      p_preassignment_id: item.id,
      p_customer_id: selectedCustomerId,
    });
    if (error) throw error;
  }

  async function saveQuantity(item: LiveItem) {
    if (item.status !== "pending") return;
    if (newQuantity < 1) throw new Error("La cantidad debe ser mayor a cero.");
    if (Number(item.quantity) === Number(newQuantity)) return;
    const { error } = await supabase.rpc("change_live_preassignment_quantity", {
      p_preassignment_id: item.id,
      p_new_quantity: Number(newQuantity),
    });
    if (error) throw error;
  }

  async function saveChanges(item: LiveItem) {
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      await linkCustomer(item);
      await saveQuantity(item);
      setMessage("Cambios guardados.");
      cancelEdit();
      await loadLives();
    } catch (e: any) {
      setError(e?.message || "No se pudieron guardar los cambios.");
    } finally {
      setBusyId(null);
    }
  }

  async function getOrCreateOpenOrder(customerId: string) {
    const { data: existing, error: findError } = await supabase
      .from("orders")
      .select("id")
      .eq("customer_id", customerId)
      .in("status", ["open", "reopened"])
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;
    if (existing?.id) return existing.id as string;

    const { data: created, error: createError } = await supabase
      .from("orders")
      .insert({ customer_id: customerId })
      .select("id")
      .single();

    if (createError) throw createError;
    return created.id as string;
  }

  async function assignItem(item: LiveItem) {
    if (!selectedCustomerId) {
      setError("Primero selecciona la clienta correcta.");
      return;
    }

    setBusyId(item.id);
    setError("");
    setMessage("");

    try {
      await linkCustomer(item);
      await saveQuantity(item);

      const orderId = await getOrCreateOpenOrder(selectedCustomerId);

      const { error: assignError } = await supabase.rpc(
        "assign_live_preassignment_to_order",
        {
          p_preassignment_id: item.id,
          p_order_id: orderId,
          p_unit_price: item.price,
        }
      );
      if (assignError) throw assignError;

      setMessage("Preasignación asignada a la apertura de la clienta.");
      cancelEdit();
      await loadLives();
    } catch (e: any) {
      setError(e?.message || "No se pudo asignar la preasignación.");
    } finally {
      setBusyId(null);
    }
  }

  async function rejectItem(item: LiveItem) {
    if (!window.confirm(`¿Rechazar ${item.product_code || "este producto"} para ${item.customer_name || item.dictated_customer_name || "esta clienta"}?`)) return;

    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      const fn = item.status === "waiting"
        ? "reject_waiting_live_preassignment"
        : "reject_live_preassignment";

      const { error: rejectError } = await supabase.rpc(fn, {
        p_preassignment_id: item.id,
      });
      if (rejectError) throw rejectError;

      setMessage("Solicitud rechazada. La reserva fue liberada cuando correspondía.");
      if (editingId === item.id) cancelEdit();
      await loadLives();
    } catch (e: any) {
      setError(e?.message || "No se pudo rechazar la solicitud.");
    } finally {
      setBusyId(null);
    }
  }

  async function reserveWaiting(item: LiveItem) {
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      const { error: reserveError } = await supabase.rpc(
        "reserve_waiting_live_preassignment",
        { p_preassignment_id: item.id }
      );
      if (reserveError) throw reserveError;
      setMessage("La solicitud pasó de espera a pendiente y reservó stock.");
      await loadLives();
    } catch (e: any) {
      setError(e?.message || "Todavía no se puede reservar esta solicitud.");
    } finally {
      setBusyId(null);
    }
  }

  async function markDistributed(live: LiveOrder) {
    setError("");
    setMessage("");
    const { error: rpcError } = await supabase.rpc("mark_live_as_distributed", {
      p_live_session_id: live.id,
    });
    if (rpcError) {
      setError(rpcError.message || "No se pudo marcar el Live como distribuido.");
      return;
    }
    setMessage("Live marcado como distribuido.");
    await loadLives();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PackageCheck size={25} className="text-rose-800" />
            <h1 className="text-2xl font-bold text-[#54263b]">Pedidos Live</h1>
          </div>
          <p className="mt-1 text-sm text-[#7a5362]">Revisa, vincula y reparte las solicitudes de cada transmisión.</p>
        </div>
        <button onClick={loadLives} disabled={loading} className="flex items-center gap-2 rounded-lg border border-[#cda7b4] bg-white px-3 py-2 text-sm text-[#6d2943] disabled:opacity-50">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Actualizar
        </button>
      </div>

      {message && <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-[#e3cbd3] bg-white p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código, producto o nombre dicho en el Live…"
          className="w-full rounded-lg border border-[#d6aebc] px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9b365c]/20"
        />
      </div>

      {loading && <div className="rounded-xl border border-[#ead8de] bg-white p-6 text-center text-sm text-[#7a5362]">Cargando Pedidos Live…</div>}
      {!loading && !error && filtered.length === 0 && <div className="rounded-xl border border-[#ead8de] bg-white p-8 text-center text-sm text-[#7a5362]">No hay Lives para mostrar.</div>}

      {!loading && filtered.map((live) => {
        const open = openId === live.id;
        const totalUnits = live.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const unresolved = live.items.filter((x) => x.status === "pending" || x.status === "waiting").length;

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
                      const editing = editingId === item.id;
                      const canEdit = item.status === "pending";
                      const isWaiting = item.status === "waiting";
                      const done = item.status === "assigned" || item.status === "rejected";

                      return (
                        <div key={item.id} className="rounded-xl border border-[#ead8de] bg-[#fffafb] p-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-center">
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

                            {!done && (
                              <div className="flex flex-wrap gap-2">
                                {isWaiting && (
                                  <button
                                    onClick={() => reserveWaiting(item)}
                                    disabled={busyId === item.id}
                                    className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 disabled:opacity-50"
                                  >
                                    <Hourglass size={15} /> Reservar
                                  </button>
                                )}

                                {canEdit && (
                                  <button
                                    onClick={() => editing ? cancelEdit() : beginEdit(item)}
                                    className="rounded-lg border border-[#cda7b4] bg-white px-3 py-2 text-sm text-[#6d2943]"
                                  >
                                    {editing ? "Cancelar" : "Repartir"}
                                  </button>
                                )}

                                <button
                                  onClick={() => rejectItem(item)}
                                  disabled={busyId === item.id}
                                  className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                                >
                                  <XCircle size={15} /> Rechazar
                                </button>
                              </div>
                            )}
                          </div>

                          {editing && canEdit && (
                            <div className="mt-4 rounded-xl border border-[#e1c7d0] bg-white p-4">
                              <div className="grid gap-4 lg:grid-cols-[1fr_180px]">
                                <div>
                                  <label className="mb-1 block text-xs font-semibold text-[#6b3147]">Buscar clienta real</label>
                                  <div className="relative">
                                    <Search size={16} className="absolute left-3 top-3 text-[#9a7583]" />
                                    <input
                                      value={customerSearch}
                                      onChange={(e) => {
                                        setCustomerSearch(e.target.value);
                                        setSelectedCustomerId("");
                                      }}
                                      placeholder="Nombre o teléfono…"
                                      className="w-full rounded-lg border border-[#d6aebc] py-2.5 pl-9 pr-3 text-sm outline-none"
                                    />
                                  </div>

                                  <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-[#ead8de]">
                                    {customerMatches.map((c) => (
                                      <button
                                        key={c.id}
                                        onClick={() => {
                                          setSelectedCustomerId(c.id);
                                          setCustomerSearch(c.name);
                                        }}
                                        className={`flex w-full items-center justify-between border-b border-[#f1e4e8] px-3 py-2 text-left text-sm last:border-b-0 ${
                                          selectedCustomerId === c.id ? "bg-[#f8e9ef] font-semibold" : "bg-white hover:bg-[#fff8fa]"
                                        }`}
                                      >
                                        <span>{c.name}</span>
                                        <span className="text-xs text-[#8b6a77]">{c.phone || ""}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs font-semibold text-[#6b3147]">Cantidad</label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={newQuantity}
                                    onChange={(e) => setNewQuantity(Math.max(1, Number(e.target.value) || 1))}
                                    className="w-full rounded-lg border border-[#d6aebc] px-3 py-2.5 text-sm outline-none"
                                  />
                                  {item.ring_size && (
                                    <div className="mt-3 rounded-lg bg-[#fff5f8] px-3 py-2 text-sm text-[#6d2943]">
                                      Talla registrada: <strong>{item.ring_size}</strong>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                  onClick={() => saveChanges(item)}
                                  disabled={busyId === item.id || !selectedCustomerId}
                                  className="flex items-center gap-2 rounded-lg border border-[#cda7b4] bg-white px-4 py-2 text-sm font-semibold text-[#6d2943] disabled:opacity-50"
                                >
                                  <Save size={16} /> Guardar cambios
                                </button>

                                <button
                                  onClick={() => assignItem(item)}
                                  disabled={busyId === item.id || !selectedCustomerId}
                                  className="flex items-center gap-2 rounded-lg bg-[#8b2148] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                                >
                                  <CheckCircle2 size={16} /> Asignar a su apertura
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {live.status === "finished" && unresolved === 0 && (
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => markDistributed(live)}
                      className="rounded-lg bg-[#54263b] px-4 py-2 text-sm font-semibold text-white"
                    >
                      Marcar Live como distribuido
                    </button>
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
