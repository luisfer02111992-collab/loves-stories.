import React, { useEffect, useMemo, useState } from "react";
import { MessageCircle, ShoppingBag } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { CatalogProduct } from "../lib/types";

function idDeSesion() {
  let id = localStorage.getItem("catalogo_session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("catalogo_session_id", id);
  }
  return id;
}

export default function CatalogoPublico() {
  const [items, setItems] = useState<CatalogProduct[]>([]);
  const [cant, setCant] = useState<Record<string, number>>({});
  const [nombreNegocio, setNombreNegocio] = useState("Loves Stories");
  const [whatsappNegocio, setWhatsappNegocio] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviado, setEnviado] = useState<string | null>(null);
  const sessionId = useMemo(() => idDeSesion(), []);

  useEffect(() => {
    supabase.rpc("catalog_release_expired").then(() => cargar());
    supabase.from("app_settings").select("business_name, whatsapp_number").eq("id", 1).single().then(({ data }) => {
      if (data?.business_name) setNombreNegocio(data.business_name);
      if (data?.whatsapp_number) setWhatsappNegocio(data.whatsapp_number);
    });
  }, []);

  async function cargar() {
    const { data } = await supabase.from("catalog_products").select("*").eq("active", true).gt("stock_available", 0).order("created_at");
    setItems((data as CatalogProduct[]) ?? []);
  }

  async function fijarCantidad(item: CatalogProduct, nueva: number) {
    nueva = Math.max(0, nueva);
    if (nueva === 0) {
      setCant({ ...cant, [item.id]: 0 });
      return;
    }
    const { data: ok } = await supabase.rpc("catalog_reserve", { p_catalog_product_id: item.id, p_session_id: sessionId, p_quantity: nueva });
    if (ok) {
      setCant({ ...cant, [item.id]: nueva });
    } else {
      alert("Ya no hay suficiente disponible de este producto.");
    }
  }

  const seleccion = items.filter((p) => (cant[p.id] ?? 0) > 0);
  const totalUnidades = seleccion.reduce((a, p) => a + cant[p.id], 0);
  const totalBs = seleccion.reduce((a, p) => a + cant[p.id] * p.price, 0);

  async function enviarPedido(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre || !telefono || seleccion.length === 0) return;
    const codigo = `CAT-${Math.floor(10000 + Math.random() * 89999)}`;
    const { data: submission } = await supabase
      .from("catalog_submissions")
      .insert({ code: codigo, customer_name: nombre, customer_phone: telefono, session_id: sessionId })
      .select()
      .single();
    if (submission) {
      await supabase.from("catalog_submission_items").insert(
        seleccion.map((p) => ({ submission_id: submission.id, catalog_product_id: p.id, quantity: cant[p.id] }))
      );
    }
    setEnviado(codigo);
  }

  function linkWhatsapp(codigo: string) {
    const lineas = seleccion.map((p) => `Código ${p.code} x ${cant[p.id]}`);
    const mensaje = `NUEVO PEDIDO\nCliente: ${nombre}\nTeléfono: ${telefono}\n\n${lineas.join("\n")}\n\nTotal unidades: ${totalUnidades}\nTotal: Bs ${totalBs}\nCódigo de pedido: ${codigo}`;
    const destino = whatsappNegocio ? whatsappNegocio.replace(/\D/g, "") : "";
    return `https://wa.me/${destino}?text=${encodeURIComponent(mensaje)}`;
  }

  if (enviado) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#2B1E2E" }}>
        <div className="max-w-sm w-full rounded-md p-6 text-center" style={{ background: "#F7F3EC" }}>
          <p className="font-cursive text-3xl mb-2" style={{ color: "#9C7A3C" }}>{nombreNegocio}</p>
          <p className="text-sm mb-4">Tu pedido {enviado} quedó registrado. Confirma el envío por WhatsApp para avisarnos.</p>
          <a href={linkWhatsapp(enviado)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
            <MessageCircle size={15} /> Enviar por WhatsApp
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-5" style={{ background: "#EDE7DE" }}>
      <p className="font-cursive text-3xl text-center mb-4" style={{ color: "#9C7A3C" }}>{nombreNegocio}</p>
      <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
        <div className="md:col-span-2 grid sm:grid-cols-2 gap-3">
          {items.map((p) => {
            const c = cant[p.id] ?? 0;
            return (
              <div key={p.id} className="p-3 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                <div className="flex items-center justify-center h-32 rounded mb-2 overflow-hidden" style={{ background: "#EDE7DE" }}>
                  {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-3xl">🖼️</span>}
                </div>
                <p className="text-sm">{p.name}</p>
                <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>{p.code} · Bs {p.price} · {p.stock_available} disp.</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={p.stock_available + c}
                    value={c}
                    onChange={(e) => setCant({ ...cant, [p.id]: Math.max(0, Number(e.target.value)) })}
                    onBlur={(e) => fijarCantidad(p, Number(e.target.value))}
                    disabled={p.stock_available <= 0 && c === 0}
                    className="w-full px-2 py-1.5 rounded text-sm text-center outline-none"
                    style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}
                  />
                </div>
              </div>
            );
          })}
          {items.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>Todavía no hay productos publicados.</p>}
        </div>

        <form onSubmit={enviarPedido} className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-2 flex items-center gap-1.5" style={{ color: "#5B4E5E" }}><ShoppingBag size={13} /> Tu pedido</p>
          {seleccion.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>Selecciona productos del catálogo.</p>}
          {seleccion.map((p) => (
            <div key={p.id} className="flex justify-between text-sm py-1"><span>{p.code} × {cant[p.id]}</span><span>Bs {p.price * cant[p.id]}</span></div>
          ))}
          <div className="flex justify-between text-sm pt-2 mt-1" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>{totalUnidades} unid.</span><span className="font-serif">Bs {totalBs}</span></div>

          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" required
            className="w-full mt-3 mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Tu teléfono" required
            className="w-full mb-3 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />

          <button type="submit" disabled={seleccion.length === 0}
            className="w-full py-2.5 rounded-md text-sm flex items-center justify-center gap-2"
            style={{ background: seleccion.length ? "#4F6F52" : "#D9D0C2", color: "#F7F3EC" }}>
            <MessageCircle size={15} /> Enviar mi pedido por WhatsApp
          </button>
        </form>
      </div>
    </div>
  );
}
