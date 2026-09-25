import React, { useEffect, useState } from "react";
import { Check, X, Clock, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { CatalogSubmission, Customer } from "../lib/types";

interface ItemPedido {
  id: string;
  catalog_product_id: string;
  code: string;
  name: string;
  cantidadOriginal: number;
  cantidadAAsignar: number;
  variant_key: string | null;
  variant_type: "ring_size" | "length_cm" | null;
}

interface PedidoConItems extends CatalogSubmission {
  items: ItemPedido[];
}

export default function PedidosCatalogo() {
  const [pedidos, setPedidos] = useState<PedidoConItems[]>([]);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [clienteManual, setClienteManual] = useState<Record<string, string>>({});
  const [busquedaCliente, setBusquedaCliente] = useState<Record<string, string>>({});

  useEffect(() => {
    cargar();
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => setClientes((data as Customer[]) ?? []));
  }, []);

  async function cargar() {
    const { data } = await supabase
      .from("catalog_submissions")
      .select("*, catalog_submission_items(id, catalog_product_id, quantity, variant_key, catalog_products(code, name, variant_type))")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const lista: PedidoConItems[] = (data ?? []).map((s: any) => ({
      ...s,
      items: (s.catalog_submission_items ?? []).map((it: any) => ({
        id: it.id,
        catalog_product_id: it.catalog_product_id,
        code: it.catalog_products?.code ?? "",
        name: it.catalog_products?.name ?? "",
        cantidadOriginal: it.quantity,
        cantidadAAsignar: it.quantity,
        variant_key: it.variant_key ?? null,
        variant_type: it.catalog_products?.variant_type ?? null,
      })),
    }));
    setPedidos(lista);
  }

  function cambiarCantidad(pedidoId: string, itemId: string, cantidad: number) {
    setPedidos((prev) =>
      prev.map((p) =>
        p.id !== pedidoId
          ? p
          : { ...p, items: p.items.map((it) => (it.id === itemId ? { ...it, cantidadAAsignar: Math.max(0, cantidad) } : it)) }
      )
    );
  }

  function normalizarTelefono(v: string) { return (v ?? "").replace(/\D/g, "").replace(/^591/, ""); }

  function clienteAutomatico(pedido: PedidoConItems) {
    const tel = normalizarTelefono(pedido.customer_phone);
    return clientes.find((c) => normalizarTelefono(c.phone) === tel) ?? null;
  }

  async function aceptar(pedido: PedidoConItems) {
    setProcesando(pedido.id);
    try {
      let cliente: { id: string } | null = null;
      const manualId = clienteManual[pedido.id];
      if (manualId) cliente = { id: manualId };
      if (!cliente) {
        const existente = clienteAutomatico(pedido);
        if (existente) cliente = { id: existente.id };
      }
      if (!cliente) {
        const { data: nuevo, error: errNuevo } = await supabase.from("customers").insert({ name: pedido.customer_name, phone: pedido.customer_phone }).select("id").single();
        if (errNuevo) throw new Error(errNuevo.message);
        cliente = nuevo;
      }
      if (!cliente) throw new Error("No se pudo determinar el cliente.");

      const items = pedido.items.map((it) => ({ catalog_product_id: it.catalog_product_id, quantity: it.cantidadAAsignar, variant_key: it.variant_key }));
      const { error } = await supabase.rpc("accept_catalog_submission", { p_submission_id: pedido.id, p_customer_id: cliente.id, p_items: items });
      if (error) throw new Error(error.message);
      await cargar();
    } catch (err: any) {
      alert(`No se pudo aceptar el pedido: ${err.message}`);
    } finally { setProcesando(null); }
  }

  async function rechazar(pedido: PedidoConItems) {
    if (!confirm(`¿Rechazar el pedido ${pedido.code}? Las unidades reservadas vuelven a estar disponibles.`)) return;
    setProcesando(pedido.id);
    await supabase.rpc("discard_catalog_submission", { p_submission_id: pedido.id });
    setProcesando(null);
    cargar();
  }

  return (
    <div>
      <p className="font-serif text-lg mb-1">Pedidos del catálogo</p>
      <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>
        Pedidos que tus clientes enviaron desde el link público. Al aceptar, se asignan al cliente en su pedido abierto.
        Si falta o está defectuosa alguna unidad, baja la cantidad antes de aceptar.
      </p>

      <div className="flex flex-col gap-3">
        {pedidos.map((p) => (
          <div key={p.id} className="p-4 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium flex items-center gap-2">
                  {p.code} · {p.customer_name}
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#EDE7DE", color: "#5B4E5E" }}>Catálogo / Sin vendedor</span>
                </p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>{p.customer_phone} · <Clock size={11} className="inline -mt-0.5" /> {new Date(p.created_at).toLocaleString("es-BO")}</p>
              </div>
            </div>
            <div style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} className="rounded mb-3">
              {p.items.map((it, i) => (
                <div key={it.id} className="flex items-center justify-between px-3 py-2" style={{ borderBottom: i < p.items.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                  <span className="text-sm">{it.code} · {it.name}{it.variant_key ? ` · ${it.variant_type==="ring_size"?"Talla "+it.variant_key:it.variant_key+" cm"}` : ""}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={it.cantidadOriginal} value={it.cantidadAAsignar}
                      onChange={(e) => cambiarCantidad(p.id, it.id, Number(e.target.value))}
                      className="w-16 px-2 py-1 rounded text-sm text-center outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                    <span className="text-xs" style={{ color: "#5B4E5E" }}>/ {it.cantidadOriginal} pedidas</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-3 p-3 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
              {clienteAutomatico(p) && !clienteManual[p.id] && <p className="text-xs mb-2" style={{ color: "#4F6F52" }}>Teléfono reconocido: se asignará a {clienteAutomatico(p)!.name} ({clienteAutomatico(p)!.phone}).</p>}
              <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>O asignar manualmente a otro cliente:</p>
              <div className="relative">
                <Search size={13} className="absolute left-2 top-2.5" />
                <input value={busquedaCliente[p.id] ?? ""} onChange={(e) => setBusquedaCliente((x) => ({ ...x, [p.id]: e.target.value }))} placeholder="Buscar nombre o teléfono" className="w-full pl-7 pr-2 py-2 rounded text-xs outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
              </div>
              {(busquedaCliente[p.id] ?? "").trim() && <div className="max-h-28 overflow-y-auto mt-1 rounded" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                {clientes.filter((c) => { const q=(busquedaCliente[p.id] ?? "").toLowerCase(); return c.name.toLowerCase().includes(q) || c.phone.includes(q); }).slice(0,6).map((c) => <button key={c.id} type="button" onClick={() => { setClienteManual((x) => ({...x,[p.id]:c.id})); setBusquedaCliente((x) => ({...x,[p.id]:`${c.name} (${c.phone})`})); }} className="block w-full text-left px-2 py-1.5 text-xs">{c.name} ({c.phone})</button>)}
              </div>}
              {clienteManual[p.id] && <p className="text-xs mt-1">Cliente elegido: {clientes.find((c) => c.id === clienteManual[p.id])?.name}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => aceptar(p)} disabled={procesando === p.id} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
                <Check size={13} /> Aceptar y asignar al cliente
              </button>
              <button onClick={() => rechazar(p)} disabled={procesando === p.id} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#F4E3E6", color: "#7A2540" }}>
                <X size={13} /> Rechazar
              </button>
            </div>
          </div>
        ))}
        {pedidos.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>No hay pedidos pendientes del catálogo.</p>}
      </div>
    </div>
  );
}
