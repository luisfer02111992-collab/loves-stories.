import React, { useEffect, useMemo, useState } from "react";
import { X, Upload, Image as ImageIcon, Search, MessageCircle, Copy, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { subirImagen } from "../lib/imagenes";
import type { CatalogProduct, Product, Customer } from "../lib/types";

export default function Catalogo() {
  const [items, setItems] = useState<CatalogProduct[]>([]);
  const [productos, setProductos] = useState<Product[]>([]);
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [mostrarListaProducto, setMostrarListaProducto] = useState(false);
  const [pendiente, setPendiente] = useState("");
  const [subiendoId, setSubiendoId] = useState<string | null>(null);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [mostrarListaCliente, setMostrarListaCliente] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    cargar();
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => setClientes((data as Customer[]) ?? []));
  }, []);

  async function cargar() {
    const { data: cat } = await supabase.from("catalog_products").select("*").order("created_at");
    const { data: prod } = await supabase.from("products").select("*").is("deleted_at", null).order("name");
    setItems((cat as CatalogProduct[]) ?? []);
    setProductos((prod as Product[]) ?? []);
  }

  const disponiblesParaPublicar = productos.filter((p) => !items.some((it) => it.product_id === p.id));
  const coincidenciasProducto = useMemo(() => {
    const q = busquedaProducto.trim().toLowerCase();
    if (!q) return [];
    return disponiblesParaPublicar.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busquedaProducto, disponiblesParaPublicar.length]);

  function elegirProducto(p: Product) {
    setPendiente(p.id);
    setBusquedaProducto(`${p.code} · ${p.name}`);
    setMostrarListaProducto(false);
  }

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
    setBusquedaProducto("");
    cargar();
  }

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

  // Usar el dominio público de producción, no la URL temporal del deployment de Vercel.
  // Puede personalizarse con VITE_PUBLIC_APP_URL sin tocar el código.
  const basePublica = (import.meta.env.VITE_PUBLIC_APP_URL || "https://loves-stories.vercel.app").replace(/\/$/, "");
  const linkCatalogo = `${basePublica}/catalogo-publico`;

  function copiarEnlace() {
    navigator.clipboard.writeText(linkCatalogo).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  const coincidenciasCliente = useMemo(() => {
    const q = busquedaCliente.trim().toLowerCase();
    if (!q) return [];
    return clientes.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 8);
  }, [busquedaCliente, clientes]);

  function linkWhatsappCatalogo(telefono: string, nombre: string) {
    const limpio = telefono.replace(/\D/g, "");
    const mensaje = `Hola ${nombre}, te comparto nuestro catálogo — puedes ver los productos disponibles y seleccionar lo que te interese: ${linkCatalogo}`;
    return `https://wa.me/${limpio}?text=${encodeURIComponent(mensaje)}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Catálogo</p>
        <div className="flex gap-2">
          <button onClick={copiarEnlace} className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            {copiado ? <Check size={13} /> : <Copy size={13} />} {copiado ? "Copiado" : "Copiar enlace"}
          </button>
          <a href={linkCatalogo} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            Ver link público
          </a>
        </div>
      </div>
      <p className="text-xs mb-3 font-mono" style={{ color: "#5B4E5E" }}>{linkCatalogo}</p>

      <div className="p-4 mb-3 relative" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2 flex items-center gap-1.5" style={{ color: "#5B4E5E" }}><MessageCircle size={13} /> Enviar catálogo por WhatsApp</p>
        <div className="relative">
          <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            <Search size={14} style={{ color: "#5B4E5E" }} />
            <input value={busquedaCliente} onChange={(e) => { setBusquedaCliente(e.target.value); setMostrarListaCliente(true); }} onFocus={() => setMostrarListaCliente(true)}
              placeholder="Buscar cliente por nombre o teléfono…" className="flex-1 text-sm outline-none bg-transparent" />
          </div>
          {mostrarListaCliente && coincidenciasCliente.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 rounded-md z-10 shadow-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              {coincidenciasCliente.map((c) => (
                <a key={c.id} href={linkWhatsappCatalogo(c.phone, c.name)} target="_blank" rel="noreferrer"
                  onClick={() => setMostrarListaCliente(false)}
                  className="block px-3 py-2 text-sm hover:bg-black/5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                  {c.name} <span style={{ color: "#5B4E5E" }}>({c.phone})</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 mb-3 relative" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Buscar y publicar un producto del inventario al catálogo público</p>
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            <Search size={14} style={{ color: "#5B4E5E" }} />
            <input value={busquedaProducto} onChange={(e) => { setBusquedaProducto(e.target.value); setMostrarListaProducto(true); setPendiente(""); }} onFocus={() => setMostrarListaProducto(true)}
              placeholder="Código o descripción…" className="flex-1 text-sm outline-none bg-transparent" />
          </div>
          <button onClick={publicar} disabled={!pendiente} className="px-4 rounded-md text-sm flex items-center gap-1.5" style={{ background: pendiente ? "#9C7A3C" : "#D9D0C2", color: "#F7F3EC" }}>
            <Upload size={14} /> Publicar
          </button>
        </div>
        {mostrarListaProducto && coincidenciasProducto.length > 0 && (
          <div className="absolute left-4 right-4 mt-1 rounded-md z-10 shadow-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
            {coincidenciasProducto.map((p) => (
              <button key={p.id} onClick={() => elegirProducto(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                {p.code} · {p.name} <span style={{ color: "#5B4E5E" }}>({p.stock_available} disp.)</span>
              </button>
            ))}
          </div>
        )}
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
