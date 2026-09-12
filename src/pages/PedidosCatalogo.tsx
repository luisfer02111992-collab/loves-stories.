import React, { useEffect, useState } from "react";
import { Check, X, Clock } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { CatalogSubmission } from "../lib/types";

interface ItemPedido {
  id: string;
  catalog_product_id: string;
  code: string;
  name: string;
  cantidadOriginal: number;
  cantidadAAsignar: number;
}

interface PedidoConItems extends CatalogSubmission {
  items: ItemPedido[];
}

export default function PedidosCatalogo() {
  const [pedidos, setPedidos] = useState<PedidoConItems[]>([]);
  const [procesando, setProcesando] = useState<string | null>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data } = await supabase
      .from("catalog_submissions")
      .select("*, catalog_submission_items(id, catalog_product_id, quantity, catalog_products(code, name))")
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

  async function aceptar(pedido: PedidoConItems) {
    setProcesando(pedido.id);
    // Busca o crea el cliente por teléfono
    let { data: cliente } = await supabase.from("customers").select("id").eq("phone", pedido.customer_phone).is("deleted_at", null).maybeSingle();
    if (!cliente) {
      const { data: nuevo } = await supabase.from("customers").insert({ name: pedido.customer_name, phone: pedido.customer_phone }).select("id").single();
      cliente = nuevo;
    }
    if (!cliente) { setProcesando(null); return; }

    const items = pedido.items.map((it) => ({ catalog_product_id: it.catalog_product_id, quantity: it.cantidadAAsignar }));
    const { error } = await supabase.rpc("accept_catalog_submission", {
      p_submission_id: pedido.id,
      p_customer_id: cliente.id,
      p_items: items,
    });
    if (error) alert(error.message);
    setProcesando(null);
    cargar();
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
                <p className="text-sm font-medium">{p.code} · {p.customer_name}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>{p.customer_phone} · <Clock size={11} className="inline -mt-0.5" /> {new Date(p.created_at).toLocaleString("es-BO")}</p>
              </div>
            </div>
            <div style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} className="rounded mb-3">
              {p.items.map((it, i) => (
                <div key={it.id} className="flex items-center justify-between px-3 py-2" style={{ borderBottom: i < p.items.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                  <span className="text-sm">{it.code} · {it.name}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={it.cantidadOriginal} value={it.cantidadAAsignar}
                      onChange={(e) => cambiarCantidad(p.id, it.id, Number(e.target.value))}
                      className="w-16 px-2 py-1 rounded text-sm text-center outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                    <span className="text-xs" style={{ color: "#5B4E5E" }}>/ {it.cantidadOriginal} pedidas</span>
                  </div>
                </div>
              ))}
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
