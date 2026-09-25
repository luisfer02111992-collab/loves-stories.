import React, { useEffect, useMemo, useState } from "react";
import { X, Upload, Image as ImageIcon, Search, MessageCircle, Copy, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { subirImagen } from "../lib/imagenes";
import type { CatalogProduct, Product, Customer } from "../lib/types";

const TALLAS_ANILLO = ["5","6","7","8","9","10","11","12","13"];
const LARGOS_CM = ["40","45","50","55","60","65","70","75","80"];

function tipoVariante(nombre: string): "ring_size" | "length_cm" | null {
  const n = (nombre || "").toLowerCase();
  if (n.includes("anillo")) return "ring_size";
  if (n.includes("cadena") || n.includes("collar")) return "length_cm";
  return null;
}
function opcionesVariante(tipo: "ring_size" | "length_cm" | null) {
  return tipo === "ring_size" ? TALLAS_ANILLO : tipo === "length_cm" ? LARGOS_CM : [];
}
function sumaVariantes(stock: Record<string, number> | null | undefined) {
  return Object.values(stock ?? {}).reduce((a, n) => a + Math.max(0, Number(n) || 0), 0);
}
function etiquetaVariante(tipo: "ring_size" | "length_cm" | null, valor: string) {
  return tipo === "ring_size" ? `Talla ${valor}` : tipo === "length_cm" ? `${valor} cm` : valor;
}

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
  const [variantesPendientes, setVariantesPendientes] = useState<Record<string, number>>({});

  useEffect(() => {
    cargar();
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => setClientes((data as Customer[]) ?? []));
  }, []);

  async function cargar() {
    const { data: prod } = await supabase.from("products").select("*").is("deleted_at", null).order("name");
    const inventario = (prod as Product[]) ?? [];
    const idsInventario = new Set(inventario.map((p) => p.id));
    const { data: cat } = await supabase.from("catalog_products").select("*").order("created_at");
    // El catálogo nunca debe mostrar registros antiguos si el producto ya no existe en el inventario activo.
    const catalogoValido = ((cat as CatalogProduct[]) ?? []).filter((it) => it.active && idsInventario.has(it.product_id));
    setItems(catalogoValido);
    setProductos(inventario);
  }

  const disponiblesParaPublicar = productos.filter((p) => p.stock_available > 0 && !items.some((it) => it.product_id === p.id));
  const coincidenciasProducto = useMemo(() => {
    const q = busquedaProducto.trim().toLowerCase();
    if (!q) return [];
    return disponiblesParaPublicar.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busquedaProducto, disponiblesParaPublicar.length]);

  function elegirProducto(p: Product) {
    setPendiente(p.id);
    setBusquedaProducto(`${p.code} · ${p.name}`);
    setVariantesPendientes({});
    setMostrarListaProducto(false);
  }

  async function publicar() {
    const producto = productos.find((p) => p.id === pendiente);
    if (!producto) return;
    const tipo = tipoVariante(producto.name);
    const totalVariantes = sumaVariantes(variantesPendientes);
    if (tipo && totalVariantes <= 0) {
      alert(tipo === "ring_size" ? "Indica al menos una talla disponible." : "Indica al menos un largo disponible.");
      return;
    }
    if (tipo && totalVariantes > producto.stock_available) {
      alert(`La suma de variantes (${totalVariantes}) no puede superar las ${producto.stock_available} unidades disponibles.`);
      return;
    }
    const stockCatalogo = tipo ? totalVariantes : producto.stock_available;
    const { error } = await supabase.from("catalog_products").insert({
      product_id: producto.id,
      code: producto.code,
      name: producto.name,
      price: producto.price,
      image_url: producto.image_url,
      stock_available: stockCatalogo,
      variant_type: tipo,
      variant_stock: tipo ? variantesPendientes : {},
    });
    if (error) { alert(`No se pudo publicar: ${error.message}`); return; }
    setPendiente("");
    setBusquedaProducto("");
    setVariantesPendientes({});
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


  function actualizarVarianteLocal(id: string, clave: string, cantidad: number, maximo: number) {
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const nuevo = { ...(it.variant_stock ?? {}), [clave]: Math.max(0, Number(cantidad) || 0) };
      const suma = sumaVariantes(nuevo);
      if (suma > maximo) return it;
      return { ...it, variant_stock: nuevo, stock_available: suma };
    }));
  }

  async function guardarVariantes(item: CatalogProduct, maximo: number) {
    const limpio = Object.fromEntries(Object.entries(item.variant_stock ?? {}).filter(([,n]) => Number(n) > 0).map(([k,n]) => [k, Number(n)]));
    const total = sumaVariantes(limpio);
    if (total > maximo) { alert(`La suma de variantes no puede superar ${maximo}.`); await cargar(); return; }
    const { error } = await supabase.from("catalog_products").update({ variant_stock: limpio, stock_available: total }).eq("id", item.id);
    if (error) alert(`No se pudieron guardar las variantes: ${error.message}`);
    await cargar();
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
    // No borramos físicamente: pedidos históricos pueden referenciar este registro.
    // Lo retiramos del catálogo visible sin romper esas referencias.
    await supabase.from("catalog_products").update({ active: false, stock_available: 0 }).eq("id", id);
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
        {pendiente && (() => {
          const prod = productos.find((p) => p.id === pendiente);
          const tipo = prod ? tipoVariante(prod.name) : null;
          if (!prod || !tipo) return null;
          const opciones = opcionesVariante(tipo);
          const total = sumaVariantes(variantesPendientes);
          return <div className="mt-3 p-3 rounded-md" style={{background:"#FFF",border:"1px solid #D9D0C2"}}>
            <p className="text-xs font-medium mb-2">
              {tipo==="ring_size" ? "Cantidad disponible por talla" : "Cantidad disponible por largo"}
              <span style={{color:"#5B4E5E"}}> · {total}/{prod.stock_available} unidades</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {opciones.map(op => <label key={op} className="text-xs flex items-center gap-1 px-2 py-1 rounded" style={{background:"#F7F3EC",border:"1px solid #D9D0C2"}}>
                <span>{etiquetaVariante(tipo,op)}</span>
                <input type="number" min={0} max={prod.stock_available} value={variantesPendientes[op]??0}
                  onChange={e=>{
                    const n=Math.max(0,Number(e.target.value)||0);
                    const nuevo={...variantesPendientes,[op]:n};
                    if(sumaVariantes(nuevo)<=prod.stock_available) setVariantesPendientes(nuevo);
                  }}
                  className="w-12 px-1 py-1 text-center rounded outline-none" style={{border:"1px solid #D9D0C2"}} />
              </label>)}
            </div>
            <p className="text-xs mt-2" style={{color: total===prod.stock_available?"#4F6F52":"#7A5F2D"}}>
              Solo estas variantes aparecerán en el catálogo público. No es obligatorio publicar todo el stock.
            </p>
          </div>;
        })()}
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
              {p.variant_type ? (
                <div className="flex flex-wrap items-center justify-end gap-1 max-w-xl">
                  {opcionesVariante(p.variant_type).map((op) => {
                    const maximo = productos.find((pr) => pr.id === p.product_id)?.stock_available ?? p.stock_available;
                    return <label key={op} className="text-xs flex items-center gap-1 px-1.5 py-1 rounded" style={{background:"#EDE7DE",border:"1px solid #D9D0C2"}}>
                      <span>{etiquetaVariante(p.variant_type,op)}</span>
                      <input type="number" min={0} value={p.variant_stock?.[op]??0}
                        onChange={(e)=>actualizarVarianteLocal(p.id,op,Number(e.target.value),maximo)}
                        onBlur={()=>guardarVariantes(p,maximo)}
                        className="w-11 px-1 py-1 rounded text-center outline-none" style={{background:"#F7F3EC",border:"1px solid #D9D0C2"}} />
                    </label>;
                  })}
                  <span className="text-xs" style={{color:"#5B4E5E"}}>Total {sumaVariantes(p.variant_stock)}</span>
                </div>
              ) : <>
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
              </>}
              <button onClick={() => eliminar(p.id)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#F4E3E6", color: "#7A2540" }}><X size={13} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>No hay productos publicados.</p>}
      </div>
    </div>
  );
}
