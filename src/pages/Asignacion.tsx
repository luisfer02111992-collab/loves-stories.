import React, { useEffect, useRef, useState } from "react";
import { Plus, Search, ScanBarcode, Camera, Wifi, WifiOff } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Customer, Product } from "../lib/types";

export default function Asignacion() {
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [clienteId, setClienteId] = useState<string>("");
  const [codigo, setCodigo] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [buscarFoto, setBuscarFoto] = useState(false);
  const [enLinea, setEnLinea] = useState(true);
  const [agregados, setAgregados] = useState<{ codigo: string; nombre: string; cantidad: number; precio: number; hora: string; pendiente: boolean }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => {
      setClientes((data as Customer[]) ?? []);
      if (data && data.length > 0) setClienteId((data[0] as Customer).id);
    });
  }, []);

  async function obtenerOrdenAbierta(customerId: string) {
    const { data: existente } = await supabase
      .from("orders")
      .select("id")
      .eq("customer_id", customerId)
      .in("status", ["open", "reopened"])
      .maybeSingle();
    if (existente) return existente.id as string;
    const { data: nueva } = await supabase.from("orders").insert({ customer_id: customerId }).select().single();
    return nueva!.id as string;
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) return;
    const { data: producto } = await supabase.from("products").select("*").eq("code", codigo.trim()).is("deleted_at", null).maybeSingle();
    if (!producto) {
      setNoEncontrado(true);
      return;
    }
    const orderId = await obtenerOrdenAbierta(clienteId);
    const { error } = await supabase.rpc("assign_product_to_order", {
      p_order_id: orderId,
      p_product_id: producto.id,
      p_quantity: cantidad,
      p_origin: "manual",
    });
    if (error) {
      alert(error.message);
      return;
    }
    setAgregados((prev) => [{ codigo: producto.code, nombre: producto.name, cantidad, precio: producto.price, hora: new Date().toLocaleTimeString("es-BO").slice(0, 5), pendiente: !enLinea }, ...prev]);
    setCodigo("");
    setCantidad(1);
    setNoEncontrado(false);
    setBuscarFoto(false);
    inputRef.current?.focus();
  }

  const total = agregados.reduce((a, it) => a + it.precio * it.cantidad, 0);
  const pendientes = agregados.filter((it) => it.pendiente).length;

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <div className="flex items-center justify-between mb-3 px-1">
          <button onClick={() => setEnLinea((v) => !v)} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: enLinea ? "#E4EBE1" : "#F6EAD2", color: enLinea ? "#4F6F52" : "#7A5F2D" }}>
            {enLinea ? <Wifi size={12} /> : <WifiOff size={12} />} {enLinea ? "En línea" : "Sin conexión — guardando localmente"}
          </button>
          {pendientes > 0 && <span className="text-xs" style={{ color: "#7A5F2D" }}>{pendientes} por sincronizar</span>}
        </div>

        <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-1.5" style={{ color: "#5B4E5E" }}>Cliente</p>
          <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            <Search size={14} style={{ color: "#5B4E5E" }} />
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="flex-1 text-sm outline-none bg-transparent">
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <form onSubmit={agregar} className="p-4 rounded-md mb-3" style={{ background: "#2B1E2E" }}>
          <p className="text-xs mb-2 flex items-center gap-1.5" style={{ color: "#C9BFC7" }}><ScanBarcode size={14} /> Escanear código de barras o QR</p>
          <div className="flex gap-2">
            <input ref={inputRef} autoFocus value={codigo} onChange={(e) => { setCodigo(e.target.value); setNoEncontrado(false); }} placeholder="80-50"
              className="flex-1 px-3 py-3 rounded text-lg outline-none" style={{ background: "#F7F3EC", color: "#2B1E2E" }} />
            <input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 px-2 py-3 rounded text-lg text-center outline-none" style={{ background: "#F7F3EC", color: "#2B1E2E" }} />
            <button type="submit" className="px-5 rounded flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
              <Plus size={16} /> Agregar
            </button>
            <button type="button" onClick={() => setBuscarFoto((v) => !v)} className="px-3 rounded flex items-center gap-1.5" style={{ background: buscarFoto ? "#B7791F" : "#F7F3EC", color: buscarFoto ? "#F7F3EC" : "#2B1E2E" }}>
              <Camera size={16} />
            </button>
          </div>

          {noEncontrado && (
            <div className="mt-3 p-3 rounded" style={{ background: "#F4E3E6" }}>
              <p className="text-xs" style={{ color: "#7A2540" }}>No se encontró ningún producto con ese código. Prueba la búsqueda por foto (cámara), o verifica el código.</p>
            </div>
          )}
          {buscarFoto && (
            <div className="mt-3 p-3 rounded" style={{ background: "#F7F3EC" }}>
              <label className="flex items-center gap-2 px-3 py-3 rounded mb-2 cursor-pointer justify-center text-sm" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C", color: "#7A5F2D" }}>
                <Camera size={16} /> Tomar o subir foto del producto
                <input type="file" accept="image/*" capture="environment" className="hidden" />
              </label>
              <p className="text-xs" style={{ color: "#5B4E5E" }}>
                Esta función de búsqueda por similitud de imagen todavía no está conectada a un servicio real de reconocimiento —
                cuando definamos ese servicio, aquí aparecerán los productos con foto más parecidos.
              </p>
            </div>
          )}
        </form>

        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {agregados.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Los productos escaneados aparecerán aquí.</p>}
          {agregados.map((it, i) => (
            <div key={i} className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: i < agregados.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <div>
                <p className="text-sm">{it.nombre}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>{it.codigo} · {it.cantidad} unid. · {it.hora}{it.pendiente ? " · pendiente de sincronizar" : ""}</p>
              </div>
              <span className="font-serif text-sm">Bs {it.precio * it.cantidad}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Resumen de esta sesión</p>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Unidades</span><span>{agregados.length}</span></div>
        <div className="flex justify-between text-sm pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>Total</span><span className="font-serif">Bs {total}</span></div>
      </div>
    </div>
  );
}
