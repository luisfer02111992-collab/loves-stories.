import React, { useEffect, useState } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { PurchaseBatch } from "../lib/types";

export default function Compras() {
  const [lotes, setLotes] = useState<PurchaseBatch[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [nombreEdicion, setNombreEdicion] = useState("");

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data } = await supabase.from("purchase_batches").select("*").is("deleted_at", null).order("created_at", { ascending: false });
    setLotes((data as PurchaseBatch[]) ?? []);
  }

  function exportar(lote: PurchaseBatch) {
    const blob = new Blob([JSON.stringify(lote.original_data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lote.label.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function empezarRenombrar(lote: PurchaseBatch) {
    setEditando(lote.id);
    setNombreEdicion(lote.label);
  }

  async function guardarNombre(id: string) {
    if (!nombreEdicion.trim()) return;
    // Renombrar el lote solo cambia su etiqueta: no toca productos, movimientos ni stock.
    await supabase.from("purchase_batches").update({ label: nombreEdicion.trim() }).eq("id", id);
    setEditando(null);
    cargar();
  }

  async function eliminarLote(lote: PurchaseBatch) {
    // Primero se consulta (sin modificar nada) qué productos de este lote se
    // retirarán del inventario activo — TODOS, tengan o no historial de ventas
    // (los que sí tienen historial se retiran igual del inventario activo,
    // pero su historial de ventas/PDF/devoluciones queda intacto).
    const { data: retirables, error: errorConsulta } = await supabase.rpc("productos_retirables_por_lote", { p_batch_id: lote.id });
    if (errorConsulta) {
      alert(errorConsulta.message);
      return;
    }
    const total = (retirables ?? []).length;
    const conHistorial = (retirables ?? []).filter((r: any) => r.tiene_historial).length;
    const ok = confirm(
      `¿Eliminar el lote "${lote.label}"?\n\n` +
      `${total} producto(s) de este lote se retirarán del inventario activo.\n` +
      (conHistorial > 0
        ? `${conHistorial} de ellos ya tienen historial de ventas: seguirán viéndose completos en Ventas/Reportes/PDF, solo dejan de aparecer como inventario disponible.`
        : `Ninguno tiene historial de ventas todavía.`)
    );
    if (!ok) return;

    const { error } = await supabase.rpc("eliminar_lote", { p_batch_id: lote.id });
    if (error) {
      alert(error.message);
      return;
    }
    cargar();
  }

  return (
    <div>
      <p className="font-serif text-lg mb-3">Compras · lotes cargados</p>
      <div className="flex flex-col gap-2">
        {lotes.map((l) => (
          <div key={l.id} className="p-3.5 flex items-center justify-between rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
            <div className="flex-1 min-w-0">
              {editando === l.id ? (
                <div className="flex items-center gap-2">
                  <input value={nombreEdicion} onChange={(e) => setNombreEdicion(e.target.value)} autoFocus
                    className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                  <button onClick={() => guardarNombre(l.id)} className="text-xs px-2.5 py-1.5 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Guardar</button>
                  <button onClick={() => setEditando(null)} className="text-xs px-2.5 py-1.5 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>Cancelar</button>
                </div>
              ) : (
                <p className="text-sm">{l.label} · {new Date(l.created_at).toLocaleDateString("es-BO")}</p>
              )}
              <p className="text-xs" style={{ color: "#5B4E5E" }}>{l.source === "excel" ? "Excel" : "Manual"} · {l.total_detected} productos detectados</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="text-right text-xs">
                <p style={{ color: "#4F6F52" }}>{l.total_ok} correctos</p>
                {l.total_errors > 0 && <p style={{ color: "#7A2540" }}>{l.total_errors} con error</p>}
              </div>
              <button onClick={() => empezarRenombrar(l)} className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} title="Renombrar lote">
                <Pencil size={13} />
              </button>
              <button onClick={() => exportar(l)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                <Download size={13} /> Exportar
              </button>
              <button onClick={() => eliminarLote(l)} className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "#F4E3E6", color: "#7A2540" }} title="Eliminar lote">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        {lotes.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>Todavía no se ha cargado ningún lote.</p>}
      </div>
      <p className="text-xs mt-3" style={{ color: "#5B4E5E" }}>
        Eliminar un lote retira del inventario activo a TODOS sus productos (borrado lógico), tengan o no historial de
        ventas. Los productos con historial y las ventas ya cerradas nunca se borran físicamente y siguen viéndose completos.
      </p>
    </div>
  );
}
