import React, { useEffect, useState } from "react";
import { MessageCircle, FileDown, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "../lib/supabase";
import { loadPricingRules, agruparPorProducto, PricingRule, LineaPedido } from "../lib/pricing";
import { generarPdfGrande } from "../lib/pdf";

interface Fila {
  customerId: string;
  nombre: string;
  telefono: string;
  items: LineaPedido[];
}

export default function ReportesDelDia() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [reglas, setReglas] = useState<PricingRule[]>([]);
  const [nombreNegocio, setNombreNegocio] = useState("Loves Stories");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);

  useEffect(() => {
    cargar();
    loadPricingRules().then(setReglas);
    supabase.from("app_settings").select("business_name").eq("id", 1).single().then(({ data }) => {
      if (data?.business_name) setNombreNegocio(data.business_name);
    });
  }, []);

  async function cargar() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("order_items")
      .select("id, product_id, quantity, unit_price, assigned_at, orders(customer_id, customers(name, phone)), products(code, name, category_id, image_url)")
      .gte("assigned_at", hoy.toISOString());

    const agrupado: Record<string, Fila> = {};
    (data ?? []).forEach((it: any) => {
      const cid = it.orders?.customer_id;
      if (!cid) return;
      if (!agrupado[cid]) {
        agrupado[cid] = { customerId: cid, nombre: it.orders.customers?.name ?? "Cliente", telefono: it.orders.customers?.phone ?? "", items: [] };
      }
      agrupado[cid].items.push({
        id: it.id, product_id: it.product_id, codigo: it.products?.code ?? "", nombre: it.products?.name ?? "",
        categoria_id: it.products?.category_id ?? null, cantidad: it.quantity, precio_base: it.unit_price,
        imagen: it.products?.image_url ?? null,
        fecha: new Date(it.assigned_at).toLocaleTimeString("es-BO").slice(0, 5),
      });
    });
    setFilas(Object.values(agrupado));
  }

  function linkWhatsapp(f: Fila, total: number) {
    const detalle = f.items.map((it) => `${it.codigo} x${it.cantidad}`).join(", ");
    const mensaje = `Hola ${f.nombre}. Hoy se agregó a tu pedido en ${nombreNegocio}: ${detalle}. Total agregado hoy: Bs ${total.toFixed(2)}. Cualquier consulta, escríbenos.`;
    return `https://wa.me/${f.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`;
  }

  async function generarPdfDiario(f: Fila) {
    const grupos = agruparPorProducto(reglas, f.items);
    const subtotalSinDescuento = grupos.reduce((a, g) => a + g.subtotalSinDescuento, 0);
    const total = grupos.reduce((a, g) => a + g.subtotalConDescuento, 0);
    setGenerando(f.customerId);
    await generarPdfGrande({
      negocio: nombreNegocio, cliente: f.nombre, telefono: f.telefono,
      fecha: new Date().toLocaleDateString("es-BO"), titulo: "Detalle del día",
      grupos, subtotalSinDescuento, descuentoTotal: subtotalSinDescuento - total, total,
      depositado: 0, saldoPendiente: 0, saldoAFavor: 0, mostrarPagos: false,
    });
    setGenerando(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="font-serif text-lg">Reportes del día</p>
      </div>
      <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>
        Detalle exacto de lo que recibió cada cliente hoy (código, descripción, cantidad, precio, descuento y subtotal).
      </p>
      <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        {filas.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Nadie tiene ítems asignados hoy todavía.</p>}
        {filas.map((f, i) => {
          const grupos = agruparPorProducto(reglas, f.items);
          const total = grupos.reduce((a, g) => a + g.subtotalConDescuento, 0);
          const abierto = expandido === f.customerId;
          return (
            <div key={f.customerId} style={{ borderBottom: i < filas.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <div className="flex items-center justify-between px-3.5 py-3">
                <button onClick={() => setExpandido(abierto ? null : f.customerId)} className="flex items-center gap-2 text-left flex-1">
                  {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <div>
                    <p className="text-sm">{f.nombre}</p>
                    <p className="text-xs" style={{ color: "#5B4E5E" }}>{f.telefono} · {grupos.length} producto(s) · Bs {total.toFixed(2)} agregado hoy</p>
                  </div>
                </button>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => generarPdfDiario(f)} disabled={generando === f.customerId} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                    <FileDown size={12} /> {generando === f.customerId ? "Generando..." : "PDF diario"}
                  </button>
                  <a href={linkWhatsapp(f, total)} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                    <MessageCircle size={12} /> WhatsApp
                  </a>
                </div>
              </div>
              {abierto && (
                <div className="px-3.5 pb-3" style={{ background: "#EDE7DE" }}>
                  {grupos.map((g) => (
                    <div key={g.product_id} className="flex justify-between text-xs py-1.5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                      <span>{g.codigo} · {g.nombre} × {g.cantidadTotal}</span>
                      <span>Bs {g.subtotalConDescuento.toFixed(2)} {g.descuento > 0 && `(desc. Bs ${g.descuento.toFixed(2)})`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
