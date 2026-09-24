import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Seller } from "../lib/types";

export default function Vendedores() {
  const [vendedores, setVendedores] = useState<Seller[]>([]);
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [nombre, setNombre] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const [tipoComision, setTipoComision] = useState<"none" | "percentage" | "fixed">("none");
  const [valorComision, setValorComision] = useState(0);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data } = await supabase.from("sellers").select("*").order("name");
    setVendedores((data as Seller[]) ?? []);
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    await supabase.from("sellers").insert({ name: nombre.trim() });
    setNombre("");
    setMostrarNuevo(false);
    cargar();
  }

  function empezarEditar(v: Seller) {
    setEditando(v.id);
    setNombreEdit(v.name);
    setTipoComision(v.commission_type);
    setValorComision(v.commission_value);
  }

  async function guardarComision(id: string) {
    if (!nombreEdit.trim()) return alert("El nombre es obligatorio.");
    await supabase.from("sellers").update({ name: nombreEdit.trim(), commission_type: tipoComision, commission_value: tipoComision === "none" ? 0 : valorComision, updated_at: new Date().toISOString() }).eq("id", id);
    setEditando(null);
    cargar();
  }

  async function eliminar(v: Seller) {
    if (!confirm(`¿ELIMINAR POR COMPLETO al vendedor "${v.name}"?\n\nEsta acción es permanente. También se eliminarán sus sesiones de vendedor. En registros históricos que aún existan, la venta quedará sin vendedor asignado.\n\nNo se podrá restaurar.`)) return;
    const { error } = await supabase.rpc("delete_seller_completely", { p_seller_id: v.id });
    if (error) {
      alert(`No se pudo eliminar el vendedor: ${error.message}`);
      return;
    }
    await cargar();
    alert(`Vendedor "${v.name}" eliminado por completo.`);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Vendedores</p>
        <button onClick={() => setMostrarNuevo((v) => !v)} className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
          <Plus size={13} /> Nuevo vendedor
        </button>
      </div>

      {mostrarNuevo && (
        <form onSubmit={crear} className="p-3 mb-3 rounded-md flex gap-2" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del vendedor" required
            className="flex-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
          <button type="submit" className="text-xs px-3 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Guardar</button>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {vendedores.map((v) => (
          <div key={v.id} className="p-3.5 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2", opacity: v.active ? 1 : 0.6 }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">{v.name}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>
                  {v.commission_type === "none" && "Comisión no configurada"}
                  {v.commission_type === "percentage" && `Comisión: ${v.commission_value}% sobre venta`}
                  {v.commission_type === "fixed" && `Comisión: Bs ${v.commission_value} fijo por unidad`}
                  {!v.active && " · Inactivo"}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => empezarEditar(v)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                  <Pencil size={12} /> Editar
                </button>
                <button onClick={() => eliminar(v)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ background: "#F4E3E6", color: "#7A2540" }}>
                  <Trash2 size={12} /> Eliminar
                </button>
              </div>
            </div>

            {editando === v.id && (
              <div className="mt-3 p-3 rounded flex items-end gap-2 flex-wrap" style={{ background: "#EDE7DE" }}>
                <div className="min-w-48 flex-1">
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Nombre</p>
                  <input value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} className="w-full px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Tipo de comisión</p>
                  <select value={tipoComision} onChange={(e) => setTipoComision(e.target.value as any)} className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                    <option value="none">Sin configurar</option>
                    <option value="percentage">Porcentaje sobre venta</option>
                    <option value="fixed">Monto fijo por unidad</option>
                  </select>
                </div>
                {tipoComision !== "none" && (
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>{tipoComision === "percentage" ? "Porcentaje (%)" : "Monto fijo (Bs)"}</p>
                    <input type="number" min={0} value={valorComision} onChange={(e) => setValorComision(Number(e.target.value))}
                      className="w-28 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                )}
                <button onClick={() => guardarComision(v.id)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Guardar</button>
                <button onClick={() => setEditando(null)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>Cancelar</button>
              </div>
            )}
          </div>
        ))}
        {vendedores.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>Todavía no registraste ningún vendedor.</p>}
      </div>
    </div>
  );
}
