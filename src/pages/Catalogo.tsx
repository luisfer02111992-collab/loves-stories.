import React, { useEffect, useState } from "react";
import { X, Upload, Image as ImageIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { subirImagen } from "../lib/imagenes";
import type { CatalogProduct, Product } from "../lib/types";

export default function Catalogo() {
  const [items, setItems] = useState<CatalogProduct[]>([]);
  const [productos, setProductos] = useState<Product[]>([]);
  const [pendiente, setPendiente] = useState("");
  const [subiendoId, setSubiendoId] = useState<string | null>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data: cat } = await supabase.from("catalog_products").select("*").order("created_at");
    const { data: prod } = await supabase.from("products").select("*").is("deleted_at", null).order("name");
    setItems((cat as CatalogProduct[]) ?? []);
    setProductos((prod as Product[]) ?? []);
  }

  const disponiblesParaPublicar = productos.filter((p) => !items.some((it) => it.product_id === p.id));

  async function publicar() {
    const producto = productos.find((p) => p.id === pendiente);
    if (!producto) return;
    await supabase.from("catalog_products").insert({
      product_id: producto.id,
      code: producto.code,
      name: producto.name,
      price: producto.price,
      image_url: producto.image_url,
      // Nunca stock_physical: el límite real de disponibilidad es stock_available
      // (físico menos lo ya reservado/asignado). Supabase además lo vuelve a
      // recortar por su cuenta con un trigger si llegara a exceder el stock real.
      stock_available: producto.stock_available,
    });
    setPendiente("");
    cargar();
  }

  // Nunca deja pasar de largo el máximo real del producto: si escriben más de lo
  // que hay, se recorta al tope. La validación definitiva igual vive en Supabase
  // (trigger validar_catalog_stock), esto es solo para que se sienta instantáneo.
  function actualizarCantidadLocal(id: string, cantidad: number, maximo: number) {
    const limitada = Math.min(Math.max(0, cantidad), maximo);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, stock_available: limitada } : it)));
  }

  async function guardarCantidad(id: string, cantidad: number, maximo: number) {
    const limitada = Math.min(Math.max(0, cantidad), maximo);
    await supabase.from("catalog_products").update({ stock_available: limitada }).eq("id", id);
    cargar();
  }

  async function subirImagenCatalogo(id: string, file: File) {
    setSubiendoId(id);
    const url = await subirImagen(file, "catalogo");
    setSubiendoId(null);
    if (!url) return;
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, image_url: url } : it)));
    await supabase.from("catalog_products").update({ image_url: url }).eq("id", id);
  }

  async function eliminar(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    await supabase.from("catalog_products").delete().eq("id", id);
  }

  const linkCatalogo = `${window.location.origin}/catalogo-publico`;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Catálogo</p>
        <a href={linkCatalogo} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
          Ver link público
        </a>
      </div>
      <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>
        Comparte este enlace con tus clientes — lo abren desde el celular y te envían su pedido por WhatsApp: <span className="font-mono">{linkCatalogo}</span>
      </p>

      <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Cargar un ítem del inventario al catálogo público</p>
        <div className="flex gap-2">
          <select value={pendiente} onChange={(e) => setPendiente(e.target.value)} className="flex-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            <option value="">Selecciona un producto…</option>
            {disponiblesParaPublicar.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
          <button onClick={publicar} disabled={!pendiente} className="px-4 rounded-md text-sm flex items-center gap-1.5" style={{ background: pendiente ? "#9C7A3C" : "#D9D0C2", color: "#F7F3EC" }}>
            <Upload size={14} /> Publicar
          </button>
        </div>
      </div>

      <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        {items.map((p, i) => (
          <div key={p.id} className="flex items-center justify-between px-3.5 py-2.5 gap-3" style={{ borderBottom: i < items.length - 1 ? "1px solid #D9D0C2" : "none" }}>
            <div className="flex items-center gap-3 min-w-0">
              {p.image_url ? (
                <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded flex items-center justify-center shrink-0" style={{ background: "#EDE7DE" }}>
                  <ImageIcon size={14} style={{ color: "#5B4E5E" }} />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm truncate">{p.name}</p>
                <p className="text-xs" style={{ color: "#5B4E5E" }}>{p.code} · Bs {p.price}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!p.image_url && (
                <label className="text-xs px-2.5 py-1.5 rounded-md cursor-pointer" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C", color: "#7A5F2D" }}>
                  {subiendoId === p.id ? "Subiendo…" : "Cargar imagen"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && subirImagenCatalogo(p.id, e.target.files[0])} />
                </label>
              )}
              <p className="text-xs" style={{ color: "#5B4E5E" }}>Cant. (máx. {productos.find((pr) => pr.id === p.product_id)?.stock_available ?? p.stock_available})</p>
              <input
                type="number"
                min={0}
                max={productos.find((pr) => pr.id === p.product_id)?.stock_available ?? p.stock_available}
                value={p.stock_available}
                onChange={(e) => actualizarCantidadLocal(p.id, Number(e.target.value), productos.find((pr) => pr.id === p.product_id)?.stock_available ?? p.stock_available)}
                onBlur={(e) => guardarCantidad(p.id, Number(e.target.value), productos.find((pr) => pr.id === p.product_id)?.stock_available ?? p.stock_available)}
                className="w-16 px-2 py-1.5 rounded text-sm text-center outline-none"
                style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}
              />
              <button onClick={() => eliminar(p.id)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#F4E3E6", color: "#7A2540" }}><X size={13} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>No hay productos publicados.</p>}
      </div>
    </div>
  );
}
