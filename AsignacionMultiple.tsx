import React, { useEffect, useMemo, useState } from "react";
import { Share2, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSellerSession } from "../hooks/useSellerSession";
import type { Customer, Product } from "../lib/types";

export default function AsignacionMultiple() {
  const { vendedorActivoId, sesionActivaId } = useSellerSession();
  const [productos, setProductos] = useState<Product[]>([]);
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [productoId, setProductoId] = useState("");
  const [mostrarLista, setMostrarLista] = useState(false);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    supabase.from("products").select("*").is("deleted_at", null).gt("stock_available", 0).order("name").then(({ data }) => {
      setProductos((data as Product[]) ?? []);
    });
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => {
      setClientes((data as Customer[]) ?? []);
      const inicial: Record<string, number> = {};
      (data as Customer[] ?? []).forEach((c) => (inicial[c.id] = 0));
      setCantidades(inicial);
    });
  }, []);

  const producto = productos.find((p) => p.id === productoId);
  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return productos.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [busqueda, productos]);

  let totalAsignado = 0;
  for (const key in cantidades) totalAsignado += Number(cantidades[key]) || 0;
  const restante = (producto?.stock_available ?? 0) - totalAsignado;

  function elegirProducto(p: Product) {
    setProductoId(p.id);
    setBusqueda(`${p.code} · ${p.name}`);
    setMostrarLista(false);
  }

  async function confirmar() {
    if (!producto) return;
    setEnviando(true);
    for (const clienteId in cantidades) {
      const cantidad = Number(cantidades[clienteId]) || 0;
      if (cantidad <= 0) continue;
      const { data: existente } = await supabase
        .from("orders").select("id").eq("customer_id", clienteId).in("status", ["open", "reopened"]).maybeSingle();
      const orderId = existente ? existente.id : (await supabase.from("orders").insert({ customer_id: clienteId }).select().single()).data!.id;
      await supabase.rpc("assign_product_to_order", {
        p_order_id: orderId, p_product_id: producto.id, p_quantity: cantidad, p_origin: "manual",
        p_seller_id: vendedorActivoId, p_session_id: sesionActivaId,
      });
    }
    setEnviando(false);
    const reinicio: Record<string, number> = {};
    clientes.forEach((c) => (reinicio[c.id] = 0));
    setCantidades(reinicio);
    setBusqueda("");
    setProductoId("");
    supabase.from("products").select("*").is("deleted_at", null).gt("stock_available", 0).order("name").then(({ data }) => setProductos((data as Product[]) ?? []));
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <p className="font-serif text-lg mb-1">Asignar un código a varios clientes</p>
        <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>Reparte las unidades de un mismo producto entre todos los clientes que lo pidieron.</p>

        <div className="p-4 mb-3 relative" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-1.5" style={{ color: "#5B4E5E" }}>Buscar producto por código o descripción</p>
          <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            <Search size={14} style={{ color: "#5B4E5E" }} />
            <input
              value={busqueda}
              onChange={(e) => { setBusqueda(e.target.value); setMostrarLista(true); setProductoId(""); }}
              onFocus={() => setMostrarLista(true)}
              placeholder="Ej: 8169 o Anillo…"
              className="flex-1 text-sm outline-none bg-transparent"
            />
          </div>
          {mostrarLista && coincidencias.length > 0 && (
            <div className="absolute left-4 right-4 mt-1 rounded-md z-10 shadow-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              {coincidencias.map((p) => (
                <button key={p.id} onClick={() => elegirProducto(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                  {p.code} · {p.name} <span style={{ color: "#5B4E5E" }}>({p.stock_available} disp.)</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <div className="grid grid-cols-3 px-3.5 py-2 text-xs" style={{ color: "#5B4E5E", borderBottom: "1px solid #D9D0C2" }}>
            <span>Cliente</span><span>Teléfono</span><span>Cantidad</span>
          </div>
          {clientes.map((c, i) => (
            <div key={c.id} className="grid grid-cols-3 px-3.5 py-2.5 items-center" style={{ borderBottom: i < clientes.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <span className="text-sm">{c.name}</span>
              <span className="text-xs" style={{ color: "#5B4E5E" }}>{c.phone}</span>
              <input type="number" min={0} value={cantidades[c.id] ?? 0} onChange={(e) => setCantidades({ ...cantidades, [c.id]: Number(e.target.value) })}
                className="w-20 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Resumen de reparto</p>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Disponible</span><span>{producto?.stock_available ?? 0}</span></div>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Asignado ahora</span><span>{totalAsignado}</span></div>
        <div className="flex justify-between text-sm pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}>
          <span style={{ color: restante < 0 ? "#7A2540" : "#5B4E5E" }}>Restante</span>
          <span className="font-serif" style={{ color: restante < 0 ? "#7A2540" : "#2B1E2E" }}>{restante}</span>
        </div>
        {restante < 0 && <p className="text-xs mt-2" style={{ color: "#7A2540" }}>Estás repartiendo más unidades de las que hay en stock.</p>}
        <button onClick={confirmar} disabled={!producto || totalAsignado === 0 || restante < 0 || enviando}
          className="w-full mt-3 py-2.5 rounded-md text-sm flex items-center justify-center gap-2"
          style={{ background: producto && totalAsignado > 0 && restante >= 0 ? "#9C7A3C" : "#D9D0C2", color: "#F7F3EC" }}>
          <Share2 size={15} /> {enviando ? "Asignando..." : "Confirmar asignación"}
        </button>
      </div>
    </div>
  );
}
