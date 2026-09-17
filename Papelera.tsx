import React, { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { supabase } from "../lib/supabase";

interface Eliminado {
  id: string;
  tipo: "Cliente" | "Producto";
  nombre: string;
  fecha: string;
}

export default function Papelera() {
  const [eliminados, setEliminados] = useState<Eliminado[]>([]);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data: clientes } = await supabase.from("customers").select("id, name, deleted_at").not("deleted_at", "is", null);
    const { data: productos } = await supabase.from("products").select("id, name, deleted_at").not("deleted_at", "is", null);
    const lista: Eliminado[] = [
      ...((clientes ?? []).map((c: any) => ({ id: c.id, tipo: "Cliente" as const, nombre: c.name, fecha: c.deleted_at }))),
      ...((productos ?? []).map((p: any) => ({ id: p.id, tipo: "Producto" as const, nombre: p.name, fecha: p.deleted_at }))),
    ];
    setEliminados(lista);
  }

  async function restaurar(e: Eliminado) {
    const tabla = e.tipo === "Cliente" ? "customers" : "products";
    await supabase.from(tabla).update({ deleted_at: null }).eq("id", e.id);
    cargar();
  }

  return (
    <div>
      <p className="font-serif text-lg mb-1">Papelera</p>
      <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>Clientes y productos eliminados. Puedes restaurarlos si fue un error.</p>
      <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        {eliminados.map((e, i) => (
          <div key={`${e.tipo}-${e.id}`} className="flex items-center justify-between px-3.5 py-3" style={{ borderBottom: i < eliminados.length - 1 ? "1px solid #D9D0C2" : "none" }}>
            <div>
              <p className="text-sm">{e.nombre}</p>
              <p className="text-xs" style={{ color: "#5B4E5E" }}>{e.tipo} · eliminado {new Date(e.fecha).toLocaleString("es-BO")}</p>
            </div>
            <button onClick={() => restaurar(e)} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#4F6F52", color: "#F7F3EC" }}>
              <RotateCcw size={13} /> Restaurar
            </button>
          </div>
        ))}
        {eliminados.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>La papelera está vacía.</p>}
      </div>
    </div>
  );
}
