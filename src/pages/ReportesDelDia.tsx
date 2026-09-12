import React, { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { supabase } from "../lib/supabase";

interface Fila {
  customerId: string;
  nombre: string;
  telefono: string;
  items: number;
  unidades: number;
}

export default function ReportesDelDia() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [nombreNegocio, setNombreNegocio] = useState("Loves Stories");

  useEffect(() => {
    cargar();
    supabase.from("app_settings").select("business_name").eq("id", 1).single().then(({ data }) => {
      if (data?.business_name) setNombreNegocio(data.business_name);
    });
  }, []);

  async function cargar() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("order_item_history")
      .select("quantity_delta, orders(customer_id, customers(name, phone))")
      .gte("performed_at", hoy.toISOString())
      .gt("quantity_delta", 0);

    const agrupado: Record<string, Fila> = {};
    (data ?? []).forEach((h: any) => {
      const cid = h.orders?.customer_id;
      if (!cid) return;
      if (!agrupado[cid]) {
        agrupado[cid] = { customerId: cid, nombre: h.orders.customers?.name ?? "Cliente", telefono: h.orders.customers?.phone ?? "", items: 0, unidades: 0 };
      }
      agrupado[cid].items += 1;
      agrupado[cid].unidades += h.quantity_delta;
    });
    setFilas(Object.values(agrupado));
  }

  function linkWhatsapp(f: Fila) {
    const mensaje = `Hola ${f.nombre}. Hoy se agregaron ${f.unidades} unidades a tu pedido en ${nombreNegocio}. Cualquier consulta, escríbenos.`;
    return `https://wa.me/${f.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="font-serif text-lg">Reportes del día</p>
      </div>
      <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>
        Todas las personas a quienes se les asignó algún ítem hoy, listas para recibir su reporte de {nombreNegocio} por WhatsApp.
      </p>
      <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        {filas.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Nadie tiene ítems asignados hoy todavía.</p>}
        {filas.map((f, i) => (
          <div key={f.customerId} className="flex items-center justify-between px-3.5 py-3" style={{ borderBottom: i < filas.length - 1 ? "1px solid #D9D0C2" : "none" }}>
            <div>
              <p className="text-sm">{f.nombre}</p>
              <p className="text-xs" style={{ color: "#5B4E5E" }}>{f.telefono} · {f.items} ítems · {f.unidades} unidades agregadas hoy</p>
            </div>
            <a href={linkWhatsapp(f)} target="_blank" rel="noreferrer" className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
              <MessageCircle size={13} /> Preparar WhatsApp
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
