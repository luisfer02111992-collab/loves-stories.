import React, { useEffect, useState } from "react";
import { Boxes, PackageX } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import StatCard from "../components/StatCard";
import type { Product } from "../lib/types";

function desde(periodo: string) {
  const d = new Date();
  if (periodo === "dia") d.setHours(0, 0, 0, 0);
  if (periodo === "mes") d.setDate(1);
  if (periodo === "anio") { d.setMonth(0); d.setDate(1); }
  return d.toISOString();
}

export default function Reportes() {
  const [periodo, setPeriodo] = useState("dia");
  const [ventas, setVentas] = useState(0);
  const [costo, setCosto] = useState(0);
  const [unidades, setUnidades] = useState(0);
  const [porCategoria, setPorCategoria] = useState<{ cat: string; ventas: number }[]>([]);
  const [productos, setProductos] = useState<Product[]>([]);
  const [stockMuerto, setStockMuerto] = useState<{ code: string; name: string; stock_available: number; ultima: string | null }[]>([]);

  useEffect(() => {
    cargarPeriodo();
  }, [periodo]);

  useEffect(() => {
    supabase.from("products").select("*").is("deleted_at", null).then(({ data }) => setProductos((data as Product[]) ?? []));
    cargarStockMuerto();
  }, []);

  async function cargarPeriodo() {
    const { data } = await supabase
      .from("orders")
      .select("closed_at, order_items(quantity, unit_price, products(cost, categories(name)))")
      .eq("status", "closed")
      .gte("closed_at", desde(periodo));

    let v = 0, c = 0, u = 0;
    const cat: Record<string, number> = {};
    (data ?? []).forEach((o: any) => {
      (o.order_items ?? []).forEach((it: any) => {
        v += it.quantity * it.unit_price;
        c += it.quantity * (it.products?.cost ?? 0);
        u += it.quantity;
        const nombreCat = it.products?.categories?.name ?? "Otros";
        cat[nombreCat] = (cat[nombreCat] ?? 0) + it.quantity * it.unit_price;
      });
    });
    setVentas(v);
    setCosto(c);
    setUnidades(u);
    setPorCategoria(Object.entries(cat).map(([cat, ventas]) => ({ cat, ventas })));
  }

  async function cargarStockMuerto() {
    const limite = new Date();
    limite.setDate(limite.getDate() - 45);
    const { data } = await supabase.from("products").select("code, name, stock_available, updated_at").is("deleted_at", null).lt("updated_at", limite.toISOString()).gt("stock_available", 0).limit(6);
    setStockMuerto((data ?? []).map((p: any) => ({ ...p, ultima: p.updated_at })));
  }

  const ganancia = ventas - costo;
  const valorCosto = productos.reduce((a, p) => a + p.cost * p.stock_available, 0);
  const valorVenta = productos.reduce((a, p) => a + p.price * p.stock_available, 0);
  const gananciaPotencial = valorVenta - valorCosto;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Reportes</p>
        <div className="flex gap-1">
          {[{ key: "dia", label: "Día" }, { key: "mes", label: "Mes" }, { key: "anio", label: "Año" }].map((o) => (
            <button key={o.key} onClick={() => setPeriodo(o.key)} className="text-xs px-3 py-1.5 rounded-md"
              style={{ background: periodo === o.key ? "#9C7A3C" : "#F7F3EC", color: periodo === o.key ? "#F7F3EC" : "#5B4E5E", border: "1px solid #D9D0C2" }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Ventas" value={`Bs ${ventas.toLocaleString("es-BO")}`} />
        <StatCard label="Costo" value={`Bs ${costo.toLocaleString("es-BO")}`} />
        <StatCard label="Ganancia" value={`Bs ${ganancia.toLocaleString("es-BO")}`} accent="#4F6F52" />
        <StatCard label="Unidades vendidas" value={unidades} />
      </div>

      <div className="p-4 mb-4" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="font-serif text-base mb-1 flex items-center gap-2"><Boxes size={16} style={{ color: "#5B4E5E" }} /> Valor del inventario actual</p>
        <div className="grid grid-cols-3 gap-3 mt-2">
          <StatCard label="A costo" value={`Bs ${valorCosto.toLocaleString("es-BO")}`} />
          <StatCard label="A precio de venta" value={`Bs ${valorVenta.toLocaleString("es-BO")}`} accent="#9C7A3C" />
          <StatCard label="Ganancia potencial" value={`Bs ${gananciaPotencial.toLocaleString("es-BO")}`} accent="#4F6F52" />
        </div>
      </div>

      <div className="p-4 mb-4" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="font-serif text-base mb-3">Ventas por categoría</p>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={porCategoria}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9D0C2" />
              <XAxis dataKey="cat" tick={{ fontSize: 11, fill: "#5B4E5E" }} />
              <YAxis tick={{ fontSize: 11, fill: "#5B4E5E" }} />
              <Tooltip contentStyle={{ background: "#F7F3EC", border: "1px solid #D9D0C2", fontSize: 12 }} />
              <Bar dataKey="ventas" fill="#9C7A3C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-4" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="font-serif text-base mb-1 flex items-center gap-2"><PackageX size={16} style={{ color: "#5B4E5E" }} /> Productos sin movimiento</p>
        {stockMuerto.map((p, i) => (
          <div key={p.code} className="flex justify-between text-sm py-1.5" style={{ borderBottom: i < stockMuerto.length - 1 ? "1px solid #D9D0C2" : "none" }}>
            <span>{p.code} · {p.name}</span>
            <span style={{ color: "#5B4E5E" }}>{p.stock_available} unid.</span>
          </div>
        ))}
        {stockMuerto.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>No hay productos estancados por ahora.</p>}
      </div>
    </div>
  );
}
