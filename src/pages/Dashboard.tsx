import React, { useEffect, useState } from "react";
import { Clock, MessageCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import StatCard from "../components/StatCard";

interface PedidoPorVencer {
  id: string;
  cliente: string;
  dias: number;
  telefono: string;
}

function inicioDeHoy() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function badgeDias(dias: number) {
  if (dias >= 5) return { label: `Día ${dias} · alerta`, bg: "#F4E3E6", fg: "#7A2540" };
  if (dias === 4) return { label: `Día ${dias} · atención`, bg: "#F6EAD2", fg: "#7A5F2D" };
  return { label: `Día ${dias}`, bg: "#E4EBE1", fg: "#4F6F52" };
}

export default function Dashboard() {
  const [ventasHoy, setVentasHoy] = useState(0);
  const [pedidosAbiertosValor, setPedidosAbiertosValor] = useState(0);
  const [cuentasAbiertas, setCuentasAbiertas] = useState(0);
  const [depositosHoy, setDepositosHoy] = useState(0);
  const [unidadesHoy, setUnidadesHoy] = useState(0);
  const [stockBajo, setStockBajo] = useState(0);
  const [porVencer, setPorVencer] = useState<PedidoPorVencer[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mensajeWhatsApp, setMensajeWhatsApp] = useState("Hola 😊 Esperamos que estés muy bien. Queríamos comentarte que ya se cumplió el plazo de selección de tu cuenta. Para poder continuar reservando nuevas joyitas, puedes realizar el cierre de tu cuenta o un pago correspondiente. 💕 Muchas gracias por tu preferencia y comprensión.");

  useEffect(() => {
    cargar();
    const alVolver = () => cargar();
    window.addEventListener("focus", alVolver);
    return () => window.removeEventListener("focus", alVolver);
  }, []);

  async function cargar() {
    setCargando(true);
    const hoy = inicioDeHoy();
    supabase.from("app_settings").select("overdue_whatsapp_message").eq("id",1).single().then(({data})=>{ if(data?.overdue_whatsapp_message) setMensajeWhatsApp(data.overdue_whatsapp_message); });

    // Pedidos cerrados hoy → ventas del día
    const { data: cerradosHoy } = await supabase
      .from("orders")
      .select("id, order_items(quantity, unit_price)")
      .eq("status", "closed")
      .gte("closed_at", hoy);
    let ventas = 0, unidades = 0;
    (cerradosHoy ?? []).forEach((o: any) => {
      (o.order_items ?? []).forEach((it: any) => {
        ventas += it.quantity * it.unit_price;
        unidades += it.quantity;
      });
    });

    // Pedidos abiertos → valor total pendiente y antigüedad
    const { data: abiertos } = await supabase
      .from("orders")
      .select("id, customer_id, opened_at, customers(name, phone), order_items(quantity, unit_price)")
      .in("status", ["open", "reopened"]);
    let valorAbiertos = 0;
    const vencer: PedidoPorVencer[] = [];
    (abiertos ?? []).forEach((o: any) => {
      let subtotal = 0;
      (o.order_items ?? []).forEach((it: any) => (subtotal += it.quantity * it.unit_price));
      valorAbiertos += subtotal;
      const dias = Math.floor((Date.now() - new Date(o.opened_at).getTime()) / 86400000) + 1;
      if (dias >= 3) vencer.push({ id: o.id, cliente: o.customers?.name ?? "Cliente", telefono: o.customers?.phone ?? "", dias });
    });

    // Depósitos de hoy
    const { data: depositos } = await supabase.from("payments").select("amount").gte("paid_at", hoy);
    const totalDepositos = (depositos ?? []).reduce((a: number, p: any) => a + p.amount, 0);

    // Stock bajo (menos de 6 disponibles)
    const { count } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .lt("stock_available", 6)
      .eq("active", true);

    setVentasHoy(ventas);
    setUnidadesHoy(unidades);
    setPedidosAbiertosValor(valorAbiertos);
    setCuentasAbiertas(new Set((abiertos ?? []).map((o:any)=>o.customer_id).filter(Boolean)).size);
    setDepositosHoy(totalDepositos);
    setStockBajo(count ?? 0);
    setPorVencer(vencer.sort((a, b) => b.dias - a.dias).slice(0, 6));
    setCargando(false);
  }

  if (cargando) return <p className="text-sm">Cargando panel…</p>;

  return (
    <div>
      <div className="ls-home-hero mb-5 rounded-2xl overflow-hidden">
        <img src="/loves-stories-logo.jpeg" alt="LOVE'S STORIES Jewelry" className="ls-home-logo" />
        <div className="ls-home-copy">
          <p className="font-serif text-3xl md:text-4xl font-semibold">LOVE'S STORIES</p>
          <p className="tracking-[0.35em] text-sm mt-1">JEWELRY</p>
          <p className="font-cursive text-2xl mt-3">Importamos sueños, entregamos emociones.</p>
        </div>
      </div>
      <p className="font-serif text-lg mb-3">Hoy</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Ventas cerradas" value={`Bs ${ventasHoy.toLocaleString("es-BO")}`} />
        <StatCard label="Cuentas abiertas" value={cuentasAbiertas} sub={`Bs ${pedidosAbiertosValor.toLocaleString("es-BO")} seleccionados`} />
        <StatCard label="Depósitos recibidos" value={`Bs ${depositosHoy.toLocaleString("es-BO")}`} accent="#4F6F52" />
        <StatCard label="Unidades vendidas" value={unidadesHoy} />
        <StatCard label="Pedidos por vencer" value={porVencer.length} accent="#B7791F" />
        <StatCard label="Stock bajo" value={stockBajo} sub="productos" accent="#7A2540" />
      </div>

      <div className="mt-5" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid #D9D0C2" }}>
          <p className="font-serif text-base">Pedidos por antigüedad</p>
        </div>
        <div>
          {porVencer.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>No hay pedidos por vencer.</p>}
          {porVencer.map((p) => {
            const b = badgeDias(p.dias);
            return (
              <div key={p.id} className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #D9D0C2" }}>
                <div className="flex items-center gap-2">
                  <Clock size={15} style={{ color: "#5B4E5E" }} />
                  <span className="text-sm">{p.cliente}</span>
                </div>
                <div className="flex items-center gap-2"><span className="text-xs px-2.5 py-1 rounded-full" style={{ background: b.bg, color: b.fg }}>{b.label}</span>{p.dias >= 5 && p.telefono && <button onClick={() => window.open(`https://wa.me/${p.telefono.replace(/\D/g, "").replace(/^0+/, "")}?text=${encodeURIComponent(mensajeWhatsApp)}`, "_blank")} className="text-xs px-2.5 py-1 rounded-md flex items-center gap-1" style={{ background: "#4F6F52", color: "white" }}><MessageCircle size={12}/> WhatsApp</button>}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
