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
  const [descripcionPendiente, setDescripcionPendiente] = useState("");
const [imagenPendiente, setImagenPendiente] = useState<File | null>(null);
const [cantidadPendiente, setCantidadPendiente] = useState(1);
const [busquedaCatalogo, setBusquedaCatalogo] = useState("");
const [imagenAmpliada, setImagenAmpliada] = useState<string | null>(null);
  useEffect(() => {
  if (!imagenAmpliada) return;

  const cerrarConEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setImagenAmpliada(null);
    }
  };

  const cerrarConAtras = () => {
    setImagenAmpliada(null);
  };

  window.addEventListener("keydown", cerrarConEscape);
  window.history.pushState({ imagenCatalogo: true }, "");

  window.addEventListener("popstate", cerrarConAtras);

  return () => {
    window.removeEventListener("keydown", cerrarConEscape);
    window.removeEventListener("popstate", cerrarConAtras);
  };
}, [imagenAmpliada]);
  
  useEffect(() => {
    cargar();
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => setClientes((data as Customer[]) ?? []));
  }, []);

  async function cargar() {
  const TAMANO_PAGINA = 1000;

  const { count, error: countError } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  if (countError) {
    console.error("Error contando productos:", countError);
    return;
  }

  const total = count ?? 0;

  const consultas = Array.from(
    { length: Math.ceil(total / TAMANO_PAGINA) },
    (_, i) =>
      supabase
        .from("products")
        .select("*")
        .is("deleted_at", null)
        .order("name")
        .order("id")
        .range(
          i * TAMANO_PAGINA,
          Math.min(total - 1, (i + 1) * TAMANO_PAGINA - 1)
        )
  );

  const paginas = await Promise.all(consultas);
  const inventario: Product[] = [];

  for (const r of paginas) {
    if (r.error) {
      console.error("Error cargando productos:", r.error);
      continue;
    }
    inventario.push(...((r.data as Product[]) ?? []));
  }

  const idsInventario = new Set(inventario.map((p) => p.id));

  const { data: cat } = await supabase
    .from("catalog_products")
    .select("*")
    .order("created_at");

  const catalogoValido = ((cat as CatalogProduct[]) ?? []).filter(
    (it) => it.active && idsInventario.has(it.product_id)
  );

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
  setDescripcionPendiente("");
  setImagenPendiente(null);
  setCantidadPendiente(1);
  setMostrarListaProducto(false);
}

 async function publicar() {
  const producto = productos.find((p) => p.id === pendiente);
  if (!producto) return;

  const tipo = tipoVariante(producto.name);
  const totalVariantes = sumaVariantes(variantesPendientes);

  if (tipo && totalVariantes <= 0) {
    alert(
      tipo === "ring_size"
        ? "Indica al menos una talla disponible."
        : "Indica al menos un largo disponible."
    );
    return;
  }

  if (tipo && totalVariantes > producto.stock_available) {
    alert(
      `La suma de variantes (${totalVariantes}) no puede superar las ${producto.stock_available} unidades disponibles.`
    );
    return;
  }

  if (!tipo && (cantidadPendiente <= 0 || cantidadPendiente > producto.stock_available)) {
    alert(`La cantidad debe estar entre 1 y ${producto.stock_available}.`);
    return;
  }

  let imagenFinal = producto.image_url;

  if (imagenPendiente) {
    const nuevaImagen = await subirImagen(imagenPendiente, "catalogo");

    if (!nuevaImagen) {
      alert("No se pudo cargar la imagen.");
      return;
    }

    imagenFinal = nuevaImagen;

    await supabase
      .from("products")
      .update({ image_url: nuevaImagen })
      .eq("id", producto.id);
  }

  const stockCatalogo = tipo ? totalVariantes : cantidadPendiente;

  const { error } = await supabase.from("catalog_products").insert({
    product_id: producto.id,
    code: producto.code,
    name: producto.name,
    price: producto.price,
    image_url: imagenFinal,
    stock_available: stockCatalogo,
    variant_type: tipo,
    variant_stock: tipo ? variantesPendientes : {},
    display_description: descripcionPendiente.trim() || null,
  });

  if (error) {
    alert(`No se pudo guardar en catálogo: ${error.message}`);
    return;
  }

  setPendiente("");
  setBusquedaProducto("");
  setVariantesPendientes({});
  setDescripcionPendiente("");
  setImagenPendiente(null);
  setCantidadPendiente(1);

  await cargar();
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
async function guardarDescripcion(id: string, descripcion: string) {
  const { error } = await supabase
    .from("catalog_products")
    .update({ display_description: descripcion.trim() || null })
    .eq("id", id);

 if (error) {
  console.error("Error guardando descripción:", error);
  alert("ERROR: " + error.message);
  return;
}

alert("Descripción guardada correctamente");
await cargar();
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

   if (!url) {
     setSubiendoId(null);
     alert("No se pudo cargar la imagen.");
     return;
   }

   // La imagen del catálogo es independiente de la imagen del inventario.
   const { error } = await supabase
     .from("catalog_products")
     .update({ image_url: url })
     .eq("id", id);

   setSubiendoId(null);

   if (error) {
     alert("ERROR catálogo: " + error.message);
     return;
   }

   setItems((prev) =>
     prev.map((it) => (it.id === id ? { ...it, image_url: url } : it))
   );

   alert("Imagen del catálogo actualizada correctamente.");
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
const itemsCatalogoFiltrados = items.filter((p) => {
  const q = busquedaCatalogo.trim().toLowerCase();
  if (!q) return true;

  return (
    p.code.toLowerCase().includes(q) ||
    p.name.toLowerCase().includes(q)
  );
});
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

            <div
        className="p-4 mb-3 relative"
        style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}
      >
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>
          Buscar producto del inventario
        </p>

        <div className="flex items-center gap-2 px-3 py-2 rounded"
          style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}
        >
          <Search size={14} style={{ color: "#5B4E5E" }} />

          <input
            value={busquedaProducto}
            onChange={(e) => {
              setBusquedaProducto(e.target.value);
              setMostrarListaProducto(true);
              setPendiente("");
              setVariantesPendientes({});
              setDescripcionPendiente("");
              setImagenPendiente(null);
              setCantidadPendiente(1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();

                if (!pendiente && coincidenciasProducto.length > 0) {
                  elegirProducto(coincidenciasProducto[0]);
                }
              }
            }}
            onFocus={() => setMostrarListaProducto(true)}
            placeholder="Código o descripción..."
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>

        {mostrarListaProducto && coincidenciasProducto.length > 0 && (
          <div
            className="absolute left-4 right-4 mt-1 rounded-md z-20 shadow-md"
            style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}
          >
            {coincidenciasProducto.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => elegirProducto(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                style={{ borderBottom: "1px solid #D9D0C2" }}
              >
                {p.code} · {p.name}
                <span style={{ color: "#5B4E5E" }}>
                  {" "}({p.stock_available} disp.)
                </span>
              </button>
            ))}
          </div>
        )}

        {pendiente && (() => {
          const prod = productos.find((p) => p.id === pendiente);

          if (!prod) return null;

          const tipo = tipoVariante(prod.name);
          const opciones = opcionesVariante(tipo);
          const total = sumaVariantes(variantesPendientes);

          return (
            <div
              className="mt-3 p-3 rounded-md"
              style={{ background: "#FFF", border: "1px solid #D9D0C2" }}
            >
              <div className="flex items-start gap-3">

                {/* IMAGEN */}
                <div className="shrink-0">
                  {imagenPendiente ? (
                    <img
                      src={URL.createObjectURL(imagenPendiente)}
                      alt={prod.name}
                      className="w-24 h-24 rounded-md object-cover"
                      style={{ border: "1px solid #D9D0C2" }}
                    />
                  ) : prod.image_url ? (
                    <img
                      src={prod.image_url}
                      alt={prod.name}
                      className="w-24 h-24 rounded-md object-cover"
                      style={{ border: "1px solid #D9D0C2" }}
                    />
                  ) : (
                    <div
                      className="w-24 h-24 rounded-md flex items-center justify-center"
                      style={{
                        background: "#EDE7DE",
                        border: "1px solid #D9D0C2",
                      }}
                    >
                      <ImageIcon size={24} style={{ color: "#5B4E5E" }} />
                    </div>
                  )}

                  <label
                    className="block mt-2 text-center text-xs px-2 py-1.5 rounded-md cursor-pointer"
                    style={{
                      background: "#EDE7DE",
                      border: "1px dashed #9C7A3C",
                      color: "#7A5F2D",
                    }}
                  >
                    {prod.image_url || imagenPendiente
                      ? "Cambiar imagen"
                      : "Cargar imagen"}

                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const archivo = e.target.files?.[0];
                        if (archivo) setImagenPendiente(archivo);
                      }}
                    />
                  </label>
                </div>

                {/* DATOS */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{prod.name}</p>

                  <p className="text-xs mt-1" style={{ color: "#5B4E5E" }}>
                    Código: {prod.code}
                  </p>

                  <p
                    className="text-sm font-medium mt-1"
                    style={{ color: "#7A5F2D" }}
                  >
                    Bs {prod.price}
                  </p>

                  <p className="text-xs mt-1" style={{ color: "#5B4E5E" }}>
                    Stock inventario: {prod.stock_available}
                  </p>
                </div>
              </div>

              {/* CANTIDAD / TALLAS / LARGOS */}
              <div className="mt-3">
                {tipo ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <p
                        className="text-xs font-medium"
                        style={{ color: "#5B4E5E" }}
                      >
                        {tipo === "ring_size"
                          ? "Cantidad por talla"
                          : "Cantidad por largo"}
                      </p>

                      <p
                        className="text-xs font-medium"
                        style={{ color: "#7A5F2D" }}
                      >
                        Total: {total}/{prod.stock_available}
                      </p>
                    </div>

                    <div
                      className="grid gap-2"
                      style={{
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(82px, 1fr))",
                      }}
                    >
                      {opciones.map((op) => (
                        <label
                          key={op}
                          className="flex flex-col items-center justify-center px-2 py-1.5 rounded"
                          style={{
                            background: "#EDE7DE",
                            border: "1px solid #D9D0C2",
                          }}
                        >
                          <span
                            className="text-xs mb-1 whitespace-nowrap"
                            style={{ color: "#5B4E5E" }}
                          >
                            {etiquetaVariante(tipo, op)}
                          </span>

                          <input
                            type="number"
                            min={0}
                            value={variantesPendientes[op] ?? 0}
                            onChange={(e) => {
                              const n = Math.max(
                                0,
                                Number(e.target.value) || 0
                              );

                              const nuevo = {
                                ...variantesPendientes,
                                [op]: n,
                              };

                              if (
                                sumaVariantes(nuevo) <= prod.stock_available
                              ) {
                                setVariantesPendientes(nuevo);
                              }
                            }}
                            className="w-full px-1 py-1.5 rounded text-center text-sm outline-none"
                            style={{
                              background: "#F7F3EC",
                              border: "1px solid #D9D0C2",
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <div
                    className="flex items-center justify-between gap-3 p-2 rounded"
                    style={{
                      background: "#EDE7DE",
                      border: "1px solid #D9D0C2",
                    }}
                  >
                    <div>
                      <p
                        className="text-xs font-medium"
                        style={{ color: "#5B4E5E" }}
                      >
                        Cantidad a publicar
                      </p>

                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "#5B4E5E" }}
                      >
                        Máximo: {prod.stock_available}
                      </p>
                    </div>

                   <input
  type="text"
  inputMode="numeric"
  value={cantidadPendiente === 0 ? "" : cantidadPendiente}
  onFocus={(e) => e.currentTarget.select()}
  onChange={(e) => {
    const valor = e.target.value.replace(/\D/g, "");

    if (valor === "") {
      setCantidadPendiente(0);
      return;
    }

    const numero = Number(valor);

    setCantidadPendiente(
      Math.min(numero, prod.stock_available)
    );
  }}
  className="w-20 px-2 py-2 rounded text-sm text-center outline-none"
  style={{
    background: "#F7F3EC",
    border: "1px solid #D9D0C2",
  }}
/>
                  </div>
                )}
              </div>

              {/* DESCRIPCIÓN */}
              <input
                type="text"
                value={descripcionPendiente}
                onChange={(e) =>
                  setDescripcionPendiente(e.target.value)
                }
                placeholder="Descripción opcional: color, tamaño, detalle..."
                className="w-full mt-3 px-3 py-2 rounded text-xs outline-none"
                style={{
                  background: "#F7F3EC",
                  border: "1px solid #D9D0C2",
                  color: "#5B4E5E",
                }}
              />

              {/* GUARDAR */}
              <button
                type="button"
                onClick={publicar}
                className="w-full mt-3 px-4 py-2.5 rounded-md text-sm font-medium flex items-center justify-center gap-2"
                style={{
                  background: "#9C7A3C",
                  color: "#F7F3EC",
                }}
              >
                <Upload size={15} />
                Guardar en catálogo
              </button>
            </div>
          );
        })()}
      </div>
      <div
  className="p-4 mb-3"
  style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}
>
  <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>
    Buscar producto publicado
  </p>

  <div
    className="flex items-center gap-2 px-3 py-2 rounded"
    style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}
  >
    <input
      value={busquedaCatalogo}
      onChange={(e) => setBusquedaCatalogo(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      placeholder="Escribe el código..."
      className="flex-1 text-sm outline-none bg-transparent"
    />

    <Search size={17} style={{ color: "#5B4E5E" }} />
  </div>
</div>
            <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
{itemsCatalogoFiltrados.map((p, i) => {
  const maximo =
            productos.find((pr) => pr.id === p.product_id)?.stock_available ??
            p.stock_available;

          return (
            <div
              key={p.id}
              className="p-3"
              style={{
                borderBottom:
                  i < items.length - 1 ? "1px solid #D9D0C2" : "none",
              }}
            >
              {/* IMAGEN Y DATOS PRINCIPALES */}
              <div className="flex items-start gap-3">
                <div className="shrink-0">
                  {p.image_url ? (
                    <img
  src={p.image_url}
  alt={p.name}
  onClick={() => setImagenAmpliada(p.image_url)}
  className="w-20 h-20 sm:w-16 sm:h-16 rounded-md object-cover cursor-zoom-in"
  style={{ border: "1px solid #D9D0C2" }}
/>                  ) : (
                    <div
                      className="w-20 h-20 sm:w-16 sm:h-16 rounded-md flex items-center justify-center"
                      style={{
                        background: "#EDE7DE",
                        border: "1px solid #D9D0C2",
                      }}
                    >
                      <ImageIcon size={22} style={{ color: "#5B4E5E" }} />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">
                    {p.name}
                  </p>

                  <p
                    className="text-xs mt-1"
                    style={{ color: "#5B4E5E" }}
                  >
                    Código: {p.code}
                  </p>

                  <p
                    className="text-sm font-medium mt-1"
                    style={{ color: "#7A5F2D" }}
                  >
                    Bs {p.price}
                  </p>

                  <p
                    className="text-xs mt-1"
                    style={{ color: "#5B4E5E" }}
                  >
                    Stock inventario: {maximo}
                  </p>

                  {(
                    <label
                      className="inline-block mt-2 text-xs px-2.5 py-1.5 rounded-md cursor-pointer"
                      style={{
                        background: "#EDE7DE",
                        border: "1px dashed #9C7A3C",
                        color: "#7A5F2D",
                      }}
                    >
                      {subiendoId === p.id ? "Subiendo…" : "Cargar imagen"}

                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) =>
                          e.target.files?.[0] &&
                          subirImagenCatalogo(p.id, e.target.files[0])
                        }
                      />
                    </label>
                  )}
                </div>

                <button
                  onClick={() => eliminar(p.id)}
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: "#F4E3E6",
                    color: "#7A2540",
                  }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* TALLAS / LARGOS / CANTIDAD */}
              <div className="mt-3">
                {p.variant_type ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <p
                        className="text-xs font-medium"
                        style={{ color: "#5B4E5E" }}
                      >
                        {p.variant_type === "ring_size"
                          ? "Cantidad por talla"
                          : "Cantidad por largo"}
                      </p>

                      <p
                        className="text-xs font-medium"
                        style={{ color: "#7A5F2D" }}
                      >
                        Total: {sumaVariantes(p.variant_stock)}
                      </p>
                    </div>

                    <div
                      className="grid gap-2"
                      style={{
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(82px, 1fr))",
                      }}
                    >
                      {opcionesVariante(p.variant_type).map((op) => (
                        <label
                          key={op}
                          className="flex flex-col items-center justify-center px-2 py-1.5 rounded"
                          style={{
                            background: "#EDE7DE",
                            border: "1px solid #D9D0C2",
                          }}
                        >
                          <span
                            className="text-xs mb-1 whitespace-nowrap"
                            style={{ color: "#5B4E5E" }}
                          >
                            {etiquetaVariante(p.variant_type, op)}
                          </span>

                          <input
                            type="number"
                            min={0}
                            value={p.variant_stock?.[op] ?? 0}
                            onChange={(e) =>
                              actualizarVarianteLocal(
                                p.id,
                                op,
                                Number(e.target.value),
                                maximo
                              )
                            }
                            onBlur={() => guardarVariantes(p, maximo)}
                            className="w-full px-1 py-1.5 rounded text-center text-sm outline-none"
                            style={{
                              background: "#F7F3EC",
                              border: "1px solid #D9D0C2",
                            }}
                          />
                        </label>
                      ))}
                    </div>

                    <div
                      className="mt-2 px-3 py-2 rounded flex justify-between items-center"
                      style={{
                        background: "#EDE7DE",
                        border: "1px solid #D9D0C2",
                      }}
                    >
                      <span
                        className="text-xs"
                        style={{ color: "#5B4E5E" }}
                      >
                        Total publicado
                      </span>

                      <span className="text-sm font-medium">
                        {sumaVariantes(p.variant_stock)} unidades
                      </span>
                    </div>
                  </>
                ) : (
                  <div
                    className="flex items-center justify-between gap-3 p-2 rounded"
                    style={{
                      background: "#EDE7DE",
                      border: "1px solid #D9D0C2",
                    }}
                  >
                    <div>
                      <p
                        className="text-xs font-medium"
                        style={{ color: "#5B4E5E" }}
                      >
                        Cantidad publicada
                      </p>

                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "#5B4E5E" }}
                      >
                        Máximo: {maximo}
                      </p>
                    </div>

                    <input
                      type="number"
                      min={0}
                      max={maximo}
                      value={p.stock_available}
                      onChange={(e) =>
                        actualizarCantidadLocal(
                          p.id,
                          Number(e.target.value),
                          maximo
                        )
                      }
                      onBlur={(e) =>
                        guardarCantidad(
                          p.id,
                          Number(e.target.value),
                          maximo
                        )
                      }
                      className="w-20 px-2 py-2 rounded text-sm text-center outline-none"
                      style={{
                        background: "#F7F3EC",
                        border: "1px solid #D9D0C2",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* DESCRIPCIÓN */}
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  defaultValue={p.display_description ?? ""}
                  placeholder="Descripción opcional: color, tamaño, detalle..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      guardarDescripcion(p.id, e.currentTarget.value);
                      e.currentTarget.blur();
                    }
                  }}
                  className="flex-1 min-w-0 px-3 py-2 rounded text-xs outline-none"
                  style={{
                    background: "#FFF",
                    border: "1px solid #D9D0C2",
                    color: "#5B4E5E",
                  }}
                />

                <button
                  type="button"
                  onClick={(e) => {
                    const input =
                      e.currentTarget
                        .previousElementSibling as HTMLInputElement;

                    guardarDescripcion(p.id, input.value);
                  }}
                  className="px-3 py-2 rounded text-xs shrink-0"
                  style={{
                    background: "#9C7A3C",
                    color: "white",
                  }}
                >
                  Guardar
                </button>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <p
            className="text-sm p-4"
            style={{ color: "#5B4E5E" }}
          >
            No hay productos publicados.
          </p>
        )}
      </div>
      {imagenAmpliada && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    style={{ background: "rgba(0,0,0,0.85)" }}
    onClick={() => setImagenAmpliada(null)}
  >
    <button
      type="button"
      onClick={() => setImagenAmpliada(null)}
      className="absolute top-4 right-4 w-10 h-10 rounded-full text-2xl flex items-center justify-center"
      style={{ background: "#F7F3EC", color: "#5B4E5E" }}
    >
      ×
    </button>

    <img
      src={imagenAmpliada}
      alt="Imagen ampliada"
      className="max-w-full max-h-[90vh] object-contain rounded-lg"
      onClick={(e) => e.stopPropagation()}
    />
  </div>
)}
    </div>
  );
}
