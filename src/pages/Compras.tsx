import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { PurchaseBatch } from "../lib/types";

export default function Compras() {
  const [lotes, setLotes] = useState<PurchaseBatch[]>([]);

  useEffect(() => {
    supabase.from("purchase_batches").select("*").order("created_at", { ascending: false }).then(({ data }) => setLotes((data as PurchaseBatch[]) ?? []));
  }, []);

  function exportar(lote: PurchaseBatch) {
    const blob = new Blob([JSON.stringify(lote.original_data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lote.label.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <p className="font-serif text-lg mb-3">Compras · lotes cargados</p>
      <div className="flex flex-col gap-2">
        {lotes.map((l) => (
          <div key={l.id} className="p-3.5 flex items-center justify-between rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
            <div>
              <p className="text-sm">{l.label} · {new Date(l.created_at).toLocaleDateString("es-BO")}</p>
              <p className="text-xs" style={{ color: "#5B4E5E" }}>{l.source === "excel" ? "Excel" : "Manual"} · {l.total_detected} productos detectados</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs">
                <p style={{ color: "#4F6F52" }}>{l.total_ok} correctos</p>
                {l.total_errors > 0 && <p style={{ color: "#7A2540" }}>{l.total_errors} con error</p>}
              </div>
              <button onClick={() => exportar(l)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                <Download size={13} /> Exportar
              </button>
            </div>
          </div>
        ))}
        {lotes.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>Todavía no se ha cargado ningún lote.</p>}
      </div>
      <p className="text-xs mt-3" style={{ color: "#5B4E5E" }}>
        Exportar entrega el inventario tal como se cargó originalmente en ese lote, útil para hacer cruce de datos.
      </p>
    </div>
  );
}
