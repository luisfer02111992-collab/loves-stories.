import React, { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, ShoppingBag } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { CatalogProduct } from "../lib/types";
import { generarPdfCatalogo } from "../lib/pdf";

function idDeSesion() {
  let id = localStorage.getItem("catalogo_session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("catalogo_session_id", id);
  }
  return id;
}

export default function CatalogoPublico() {
  const [items, setItems] = useState<CatalogProduct[]>([]);
  const [cant, setCant] = useState<Record<string, number>>({});
  const [cantVariante, setCantVariante] = useState<Record<string, Record<string, number>>>({});
  const [nombreNegocio, setNombreNegocio] = useState("Loves Stories");
  const [whatsappNegocio, setWhatsappNegocio] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviado, setEnviado] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [imagenAmpliada, setImagenAmpliada] = useState<string | null>(null);
  const [categoria, setCategoria] = useState("Todos");
  const sessionId = useMemo(() => idDeSesion(), []);
  const imagenAmpliadaRef = useRef<string | null>(null);
const seleccionRef = useRef(0);
  useEffect(() => {
    supabase.rpc("catalog_release_expired").then(() => cargar());
    supabase.from("app_settings").select("business_name, whatsapp_number").eq("id", 1).single().then(({ data }) => {
      if (data?.business_name) setNombreNegocio(data.business_name);
      if (data?.whatsapp_number) setWhatsappNegocio(data.whatsapp_number);
    });
  }, []);

async function cargar() {
  const { data, error } = await supabase
    .from("catalog_products")
    .select("*")
    .eq("active", true)
    .gt("stock_available", 0)
    .order("created_at");

  if (error) {
    console.error("Error cargando catálogo público:", error);
    setItems([]);
    return;
  }

  setItems((data as CatalogProduct[]) ?? []);
}

  async function fijarCantidad(item: CatalogProduct, nueva: number) {
    nueva = Math.max(0, nueva);
    if (nueva === 0) { setCant({ ...cant, [item.id]: 0 }); return; }
    const { data: ok } = await supabase.rpc("catalog_reserve", { p_catalog_product_id: item.id, p_session_id: sessionId, p_quantity: nueva });
    if (ok) setCant({ ...cant, [item.id]: nueva });
    else alert("Ya no hay suficiente disponible de este producto.");
  }

  async function fijarVariante(item: CatalogProduct, clave: string, nueva: number) {
    nueva=Math.max(0,nueva);
    const maximo=Number(item.variant_stock?.[clave]??0);
    if(nueva>maximo){alert(`Solo hay ${maximo} disponibles de ${item.variant_type==="ring_size"?"talla ":""}${clave}${item.variant_type==="length_cm"?" cm":""}.`);return;}
    const actual={...(cantVariante[item.id]??{}),[clave]:nueva};
    const total=Object.values(actual).reduce((a,n)=>a+Number(n||0),0);
    if(total===0){
      setCantVariante({...cantVariante,[item.id]:actual}); setCant({...cant,[item.id]:0}); return;
    }
    const {data:ok}=await supabase.rpc("catalog_reserve",{p_catalog_product_id:item.id,p_session_id:sessionId,p_quantity:total});
    if(ok){setCantVariante({...cantVariante,[item.id]:actual});setCant({...cant,[item.id]:total})}
    else alert("Ya no hay suficiente disponible de este producto.");
  }

 function obtenerCategoria(nombre: string) {
  const n = (nombre || "").toLowerCase();

  if (n.includes("arete") || n.includes("aro")) return "Aretes";
  if (n.includes("anillo")) return "Anillos";
  if (n.includes("cadena") || n.includes("collar")) return "Collares y cadenas";
  if (n.includes("pulsera") || n.includes("brazalete")) return "Pulseras";
  if (n.includes("juego") || n.includes("set")) return "Juegos";
  if (n.includes("dije") || n.includes("colgante")) return "Dijes";

  return "Otros";
}

const categorias = useMemo(() => {
  const encontradas = Array.from(
    new Set(items.map((p) => obtenerCategoria(p.name)))
  );

  return ["Todos", ...encontradas];
}, [items]);

const itemsFiltrados = useMemo(() => {
  const q = busqueda.trim().toLowerCase();

  return items.filter((p) => {
    const coincideBusqueda =
      !q ||
      p.code.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q);

    const coincideCategoria =
      categoria === "Todos" ||
      obtenerCategoria(p.name) === categoria;

    return coincideBusqueda && coincideCategoria;
  });
}, [items, busqueda, categoria]);

  async function agregarDesdeBusqueda() {
    const q = busqueda.trim().toLowerCase();
    if (!q) return;
    const exacto = items.find((p) => p.code.toLowerCase() === q);
    const elegido = exacto ?? itemsFiltrados[0];
    if (!elegido) return;
    if (elegido.variant_type) {
      alert(elegido.variant_type==="ring_size" ? "Elige primero la talla." : "Elige primero el largo.");
      return;
    }
    await fijarCantidad(elegido, (cant[elegido.id] ?? 0) + 1);
    setBusqueda("");
  }

  const seleccion = items.filter((p) => (cant[p.id] ?? 0) > 0);
  const totalUnidades = seleccion.reduce((a, p) => a + cant[p.id], 0);
  const totalBs = seleccion.reduce((a, p) => a + cant[p.id] * p.price, 0);
  imagenAmpliadaRef.current = imagenAmpliada;
seleccionRef.current = seleccion.length;
  useEffect(() => {
  // Creamos una única barrera delante del catálogo.
  window.history.pushState({ catalogoProtegido: true }, "");

  let restaurandoHistorial = false;

  const manejarAtras = () => {
    // Este popstate fue provocado por history.forward(),
    // no por el botón Atrás del usuario.
    if (restaurandoHistorial) {
      restaurandoHistorial = false;
      return;
    }

    // 1. Si hay una foto abierta:
    // Atrás solamente cierra la foto.
    if (imagenAmpliadaRef.current) {
      imagenAmpliadaRef.current = null;
      setImagenAmpliada(null);

      // Al pulsar Atrás ya quedamos una posición detrás.
      // Regresamos a la barrera sin mostrar ningún aviso.
      restaurandoHistorial = true;
      window.history.forward();
      return;
    }

    // 2. Si existe cualquier producto seleccionado:
    // SIEMPRE debe preguntar.
    if (seleccionRef.current > 0) {
      const salir = window.confirm(
        "¿Estás seguro de que deseas salir del catálogo? Se perderá todo lo seleccionado."
      );

      // CANCELAR:
      // jamás permitimos abandonar el catálogo.
      if (!salir) {
        restaurandoHistorial = true;
        window.history.forward();
        return;
      }

// ACEPTAR: abandonar el catálogo inmediatamente.
window.removeEventListener("popstate", manejarAtras);

if (document.referrer && !document.referrer.includes(window.location.host)) {
  window.location.replace(document.referrer);
} else {
  window.location.replace("about:blank");
}

return;
    }

    // 3. Si no existe selección, puede salir normalmente.
    window.removeEventListener("popstate", manejarAtras);
    window.history.back();
  };

  window.addEventListener("popstate", manejarAtras);

  return () => {
    window.removeEventListener("popstate", manejarAtras);
  };
}, []);
  useEffect(() => {
    const manejarTecladoCatalogo = (e: KeyboardEvent) => {
      if (e.key === "Escape" && imagenAmpliadaRef.current) {
        e.preventDefault();
        imagenAmpliadaRef.current = null;
        setImagenAmpliada(null);
        return;
      }

      if (imagenAmpliadaRef.current) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

      const objetivo = e.target as HTMLElement | null;
      const tag = objetivo?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || objetivo?.isContentEditable) {
        return;
      }

      e.preventDefault();
      window.scrollBy({
        top: e.key === "ArrowDown" ? 180 : -180,
        behavior: "smooth",
      });
    };

    window.addEventListener("keydown", manejarTecladoCatalogo);
    return () => window.removeEventListener("keydown", manejarTecladoCatalogo);
  }, []);

  async function descargarPdfCatalogo(codigoPedido: string) {
  const itemsPdf = seleccion.flatMap((p) => {
    if (!p.variant_type) {
      return [
        {
          codigo: p.code,
          nombre: p.name,
          imagen: p.image_url ?? null,
          cantidad: Number(cant[p.id] ?? 0),
          precio: Number(p.price ?? 0),
          variante: null,
        },
      ];
    }

    return Object.entries(cantVariante[p.id] ?? {})
      .filter(([, q]) => Number(q) > 0)
      .map(([clave, cantidad]) => ({
        codigo: p.code,
        nombre: p.name,
        imagen: p.image_url ?? null,
        cantidad: Number(cantidad),
        precio: Number(p.price ?? 0),
        variante:
          p.variant_type === "ring_size"
            ? `Talla ${clave}`
            : `${clave} cm`,
      }));
  });

  await generarPdfCatalogo({
    negocio: nombreNegocio,
    codigoPedido,
    cliente: nombre.trim(),
    telefono: telefono.trim(),
    fecha: new Date().toLocaleString("es-BO"),
    items: itemsPdf,
    totalUnidades,
    total: totalBs,
  });
}
 async function enviarPedido(e: React.FormEvent) {
  e.preventDefault();

  if (
    !nombre.trim() ||
    !telefono.trim() ||
    seleccion.length === 0 ||
    guardando
  )
    return;

  setGuardando(true);

  try {
    const codigo = `CAT-${Date.now().toString().slice(-8)}`;

    const payload = seleccion.flatMap((p) => {
      if (!p.variant_type) {
        return [
          {
            catalog_product_id: p.id,
            quantity: cant[p.id],
            variant_key: null,
          },
        ];
      }

      return Object.entries(cantVariante[p.id] ?? {})
        .filter(([, q]) => Number(q) > 0)
        .map(([variant_key, quantity]) => ({
          catalog_product_id: p.id,
          quantity: Number(quantity),
          variant_key,
        }));
    });

    const { data, error } = await supabase.rpc(
      "submit_catalog_order",
      {
        p_code: codigo,
        p_customer_name: nombre.trim(),
        p_customer_phone: telefono.trim(),
        p_session_id: sessionId,
        p_items: payload,
      }
    );

    if (error) throw new Error(error.message);

    const codigoFinal = String(data ?? codigo);

    // Descarga automática del comprobante del catálogo.
    await descargarPdfCatalogo(codigoFinal);

    setEnviado(codigoFinal);
  } catch (err: any) {
    alert(`No se pudo registrar el pedido: ${err.message}`);
  } finally {
    setGuardando(false);
  }
}

  function linkWhatsapp(codigo: string) {
    const lineas = seleccion.flatMap((p) => {
      if (!p.variant_type) return [`Código ${p.code} x ${cant[p.id]}`];
      return Object.entries(cantVariante[p.id]??{}).filter(([,q])=>Number(q)>0).map(([k,q])=>`Código ${p.code} · ${p.variant_type==="ring_size"?"Talla "+k:k+" cm"} x ${q}`);
    });
    const mensaje = `NUEVO PEDIDO\nCliente: ${nombre}\nTeléfono: ${telefono}\n\n${lineas.join("\n")}\n\nTotal unidades: ${totalUnidades}\nTotal: Bs ${totalBs}\nCódigo de pedido: ${codigo}`;
    const destino = whatsappNegocio ? whatsappNegocio.replace(/\D/g, "") : "";
    return `https://wa.me/${destino}?text=${encodeURIComponent(mensaje)}`;
  }

 if (enviado) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#2B1E2E" }}
    >
      <div
        className="max-w-sm w-full rounded-md p-6 text-center"
        style={{ background: "#F7F3EC" }}
      >
        <p
          className="font-cursive text-3xl mb-2"
          style={{ color: "#9C7A3C" }}
        >
          {nombreNegocio}
        </p>

        <p className="text-sm mb-2">
          Tu pedido <strong>{enviado}</strong> quedó registrado.
        </p>

        <p
          className="text-xs mb-5"
          style={{ color: "#5B4E5E" }}
        >
          Descargamos el PDF con el detalle de tu pedido para que puedas
          conservarlo.
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => descargarPdfCatalogo(enviado)}
            className="w-full px-4 py-2.5 rounded-md text-sm"
            style={{
              background: "#9C7A3C",
              color: "#F7F3EC",
            }}
          >
            Descargar PDF nuevamente
          </button>

          <a
            href={linkWhatsapp(enviado)}
            target="_blank"
            rel="noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm"
            style={{
              background: "#4F6F52",
              color: "#F7F3EC",
            }}
          >
            <MessageCircle size={15} />
            Enviar pedido por WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

  return (
    <div className="min-h-screen p-5" style={{ background: "#EDE7DE" }}>
      <p className="font-cursive text-3xl text-center mb-4" style={{ color: "#9C7A3C" }}>{nombreNegocio}</p>
      <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
        <div className="md:col-span-2">
          <div className="flex gap-2 mb-3">
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarDesdeBusqueda(); } }} placeholder="Buscar por código o descripción — Enter agrega" className="flex-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
            <button type="button" onClick={agregarDesdeBusqueda} className="px-3 rounded text-sm" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Agregar</button>
          </div>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
  {categorias.map((cat) => (
    <button
      key={cat}
      type="button"
      onClick={() => setCategoria(cat)}
      className="px-3 py-2 rounded-full text-xs whitespace-nowrap"
      style={{
        background: categoria === cat ? "#9C7A3C" : "#F7F3EC",
        color: categoria === cat ? "#F7F3EC" : "#5B4E5E",
        border: "1px solid #D9D0C2",
      }}
    >
      {cat}
    </button>
  ))}
</div>
          <div className="grid sm:grid-cols-2 gap-3">
          {itemsFiltrados.map((p) => {
            const c = cant[p.id] ?? 0;
            return (
              <div key={p.id} className="p-3 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                <div className="flex items-center justify-center h-32 rounded mb-2 overflow-hidden" style={{ background: "#EDE7DE" }}>
                  {p.image_url ? (
  <img
    src={p.image_url}
    alt={p.name}
    onClick={() => {
  setImagenAmpliada(p.image_url);
  imagenAmpliadaRef.current = p.image_url;
}}
    className="w-full h-full object-cover cursor-zoom-in"
  />
) : (
  <span className="text-3xl">🖼️</span>
)}
                </div>
                <p className="text-sm">{p.name}</p>
                <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>{p.code} · Bs {p.price} · {p.stock_available} disp.</p>
                {p.display_description && (
  <p className="text-xs mb-2" style={{ color: "#9C7A3C" }}>
    {p.display_description}
  </p>
)}
                {p.variant_type ? (
                  <div>
                    <p className="text-xs mb-1" style={{color:"#5B4E5E"}}>{p.variant_type==="ring_size"?"Elige talla":"Elige largo"}</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(p.variant_stock??{}).filter(([,q])=>Number(q)>0).map(([k,max])=>{
                        const q=cantVariante[p.id]?.[k]??0;
                        return <div key={k} className="rounded p-1.5" style={{background:"#EDE7DE",border:"1px solid #D9D0C2"}}>
                          <p className="text-xs text-center mb-1">{p.variant_type==="ring_size"?`Talla ${k}`:`${k} cm`} · {max} disp.</p>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={()=>fijarVariante(p,k,Math.max(0,q-1))} className="w-7 h-7 rounded" style={{background:"#F7F3EC"}}>−</button>
                            <span className="w-6 text-center text-sm">{q}</span>
                            <button type="button" onClick={()=>fijarVariante(p,k,q+1)} className="w-7 h-7 rounded" style={{background:"#9C7A3C",color:"#F7F3EC"}}>+</button>
                          </div>
                        </div>
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => fijarCantidad(p, Math.max(0, c - 1))} className="w-9 h-9 rounded text-lg" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>−</button>
                    <input type="number" min={0} max={p.stock_available + c} value={c}
                      onChange={(e) => setCant({ ...cant, [p.id]: Math.max(0, Number(e.target.value)) })}
                      onBlur={(e) => fijarCantidad(p, Number(e.target.value))}
                      disabled={p.stock_available <= 0 && c === 0}
                      className="w-full px-2 py-1.5 rounded text-sm text-center outline-none"
                      style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                    <button type="button" onClick={() => fijarCantidad(p, c + 1)} className="w-9 h-9 rounded text-lg" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>+</button>
                  </div>
                )}
              </div>
            );
          })}
          {itemsFiltrados.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>No se encontraron productos.</p>}
          </div>
        </div>

        <form onSubmit={enviarPedido} className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-2 flex items-center gap-1.5" style={{ color: "#5B4E5E" }}><ShoppingBag size={13} /> Tu pedido</p>
          {seleccion.length === 0 && <p className="text-sm" style={{ color: "#5B4E5E" }}>Selecciona productos del catálogo.</p>}
          {seleccion.map((p) => (
            <div key={p.id} className="text-sm py-1">
              <div className="flex justify-between"><span>{p.code} × {cant[p.id]}</span><span>Bs {p.price * cant[p.id]}</span></div>
              {p.variant_type && Object.entries(cantVariante[p.id]??{}).filter(([,q])=>Number(q)>0).map(([k,q])=>
                <p key={k} className="text-xs ml-2" style={{color:"#5B4E5E"}}>{p.variant_type==="ring_size"?`Talla ${k}`:`${k} cm`}: {q}</p>
              )}
            </div>
          ))}
          <div className="flex justify-between text-sm pt-2 mt-1" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>{totalUnidades} unid.</span><span className="font-serif">Bs {totalBs}</span></div>

          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" required
            className="w-full mt-3 mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Tu teléfono" required
            className="w-full mb-3 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />

          <button type="submit" disabled={seleccion.length === 0 || guardando}
            className="w-full py-2.5 rounded-md text-sm flex items-center justify-center gap-2"
            style={{ background: seleccion.length ? "#4F6F52" : "#D9D0C2", color: "#F7F3EC" }}>
            <MessageCircle size={15} /> {guardando ? "Registrando pedido..." : "Cerrar pedido y enviar por WhatsApp"}
          </button>
        </form>
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
