import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, History, Trash2, Image as ImageIcon, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { subirImagen } from "../lib/imagenes";
import { useAuth } from "../hooks/useAuth";
import type { Product, Category } from "../lib/types";

export default function Productos() {
  const { profile } = useAuth();
  const verPrecios = profile?.role === "admin";
  const [productos, setProductos] = useState<Product[]>([]);
  const [categorias, setCategorias] = useState<Category[]>([]);
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Product>>({});
  const [historial, setHistorial] = useState<{ price: number; valid_from: string; valid_to: string | null }[]>([]);
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [nuevo, setNuevo] = useState({ code: "", name: "", category_id: "", cost: 0, price: 0, stock_physical: 0, image_url: "" });
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pestanaStock, setPestanaStock] = useState<"disponibles" | "agotados">("disponibles");
  const buscadorRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cargar();
    supabase.from("categories").select("*").order("sort_order").then(({ data }) => setCategorias((data as Category[]) ?? []));
  }, []);

  // Se ordena SIEMPRE por código (estable): editar la descripción ya no mueve
  // el producto de posición en la lista.
  async function cargar(mantenerSeleccion = false) {
    // Primero obtenemos el total y luego descargamos las páginas EN PARALELO.
    // Así 5.000+ productos cargan mucho más rápido que haciendo 6 consultas una detrás de otra.
    const TAMANO_PAGINA = 1000;
    const { count, error: countError } = await supabase.from("products").select("id", { count: "exact", head: true }).is("deleted_at", null);
    if (countError) { console.error("Error contando productos:", countError); return; }
    const total = count ?? 0;
    const consultas = Array.from({ length: Math.ceil(total / TAMANO_PAGINA) }, (_, i) =>
      supabase.from("products").select("*").is("deleted_at", null).order("code").range(i*TAMANO_PAGINA, Math.min(total-1,(i+1)*TAMANO_PAGINA-1))
    );
    const paginas = await Promise.all(consultas);
    const todos: Product[] = [];
    for (const r of paginas) { if (r.error) { console.error("Error cargando productos:", r.error); continue; } todos.push(...(((r.data as Product[]) ?? []))); }
    setProductos(todos);
    if (!mantenerSeleccion || !todos.some((p) => p.id === seleccionadoId)) setSeleccionadoId(todos.length ? todos[0].id : null);
  }

  const { disponibles, agotados, lista, unidadesDisponibles } = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const coincide = (p: Product) => !q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
    const disponibles = productos.filter((p) => Number(p.stock_available ?? p.stock_physical ?? 0) > 0 && coincide(p));
    const agotados = productos.filter((p) => Number(p.stock_available ?? p.stock_physical ?? 0) <= 0 && coincide(p));
    return {
      disponibles,
      agotados,
      lista: pestanaStock === "disponibles" ? disponibles : agotados,
      unidadesDisponibles: disponibles.reduce((total, p) => total + Number(p.stock_available ?? p.stock_physical ?? 0), 0),
    };
  }, [productos, busqueda, pestanaStock]);

  const seleccionado = lista.find((p) => p.id === seleccionadoId) ?? null;

  // Al cambiar entre Disponibles/Agotados o al filtrar, mantener la selección
  // dentro de la carpeta visible para no mostrar a la derecha un producto oculto.
  useEffect(() => {
    if (lista.length === 0) {
      setSeleccionadoId(null);
      return;
    }
    if (!lista.some((p) => p.id === seleccionadoId)) setSeleccionadoId(lista[0].id);
  }, [lista, seleccionadoId]);

  useEffect(() => {
    if (seleccionado) {
      setForm(seleccionado);
      supabase
        .from("price_history")
        .select("price, valid_from, valid_to")
        .eq("product_id", seleccionado.id)
        .order("valid_from", { ascending: true })
        .then(({ data }) => setHistorial(data ?? []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionado?.id]);

  // Navegación con ↑ / ↓: mueve la selección dentro de la lista visible
  // (respetando la búsqueda), sin interferir con lo que se está escribiendo
  // en otros campos de texto.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const activo = document.activeElement;
      const enCampoDeTexto = activo && activo !== buscadorRef.current && (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA" || activo.tagName === "SELECT");
      if (enCampoDeTexto) return;
      if (lista.length === 0) return;
      e.preventDefault();
      const idx = lista.findIndex((p) => p.id === seleccionadoId);
      const siguiente = e.key === "ArrowDown" ? Math.min(lista.length - 1, idx + 1) : Math.max(0, idx - 1);
      setSeleccionadoId(lista[siguiente]?.id ?? lista[0].id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lista, seleccionadoId]);

  // Mantiene el producto seleccionado visible cuando se navega con ↑ / ↓.
  useEffect(() => {
    if (!seleccionadoId) return;
    requestAnimationFrame(() => {
      const el = listaRef.current?.querySelector(`[data-product-id="${seleccionadoId}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [seleccionadoId]);

  async function guardar() {
    if (!seleccionado || guardando) return;
    setGuardando(true);
    const cambioPrecio = form.price !== undefined && form.price !== seleccionado.price;
    await supabase
      .from("products")
      .update({
        code: form.code,
        name: form.name,
        description: form.description,
        cost: form.cost,
        price: form.price,
        stock_physical: form.stock_physical,
        image_url: form.image_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", seleccionado.id);

    if (cambioPrecio) {
      await supabase.from("price_history").update({ valid_to: new Date().toISOString() }).eq("product_id", seleccionado.id).is("valid_to", null);
      await supabase.from("price_history").insert({ product_id: seleccionado.id, price: form.price });
    }
    await cargar(true);
    setGuardando(false);
  }

  function cancelar() {
    if (seleccionado) setForm(seleccionado);
  }

  async function subirImagenEditar(file: File) {
    setSubiendo(true);
    const url = await subirImagen(file, "productos");
    setSubiendo(false);
    if (url) setForm({ ...form, image_url: url });
  }

  async function subirImagenNuevo(file: File) {
    setSubiendo(true);
    const url = await subirImagen(file, "productos");
    setSubiendo(false);
    if (url) setNuevo({ ...nuevo, image_url: url });
  }

  async function crearProducto(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevo.code || !nuevo.name) return;
    const { data } = await supabase
      .from("products")
      .insert({
        code: nuevo.code,
        name: nuevo.name,
        category_id: nuevo.category_id || null,
        cost: nuevo.cost,
        price: nuevo.price,
        stock_physical: nuevo.stock_physical,
        image_url: nuevo.image_url || null,
      })
      .select()
      .single();
    if (data) {
      await supabase.from("price_history").insert({ product_id: data.id, price: data.price });
    }
    setMostrarNuevo(false);
    setNuevo({ code: "", name: "", category_id: "", cost: 0, price: 0, stock_physical: 0, image_url: "" });
    cargar();
  }

  async function eliminarProducto() {
    if (!seleccionado) return;
    if (!confirm(`¿Eliminar "${seleccionado.name}"? Podrás restaurarlo luego desde la Papelera.`)) return;
    await supabase.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", seleccionado.id);
    cargar();
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <div className="flex items-center justify-between mb-3">
          <p className="font-serif text-lg">Productos</p>
          <button onClick={() => setMostrarNuevo((v) => !v)} className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
            <Plus size={13} /> Nuevo
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <Search size={14} style={{ color: "#5B4E5E" }} />
          <input
            ref={buscadorRef}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (lista.length === 0) return;
              const q = busqueda.trim().toLowerCase();
              const exacto = lista.find((p) => p.code.trim().toLowerCase() === q);
              setSeleccionadoId((exacto ?? lista[0]).id);
            }}
            placeholder="Buscar por código o descripción… (Enter para seleccionar, ↑↓ para moverte)"
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>

        <div className="flex gap-1.5 mb-3">
          <button type="button" onClick={() => setPestanaStock("disponibles")} className="text-xs px-3 py-1.5 rounded-md"
            style={{ background: pestanaStock === "disponibles" ? "#4F6F52" : "#F7F3EC", color: pestanaStock === "disponibles" ? "#F7F3EC" : "#5B4E5E", border: "1px solid #D9D0C2" }}>
            Disponibles ({disponibles.length} productos · {unidadesDisponibles} unidades)
          </button>
          <button type="button" onClick={() => setPestanaStock("agotados")} className="text-xs px-3 py-1.5 rounded-md"
            style={{ background: pestanaStock === "agotados" ? "#7A2540" : "#F7F3EC", color: pestanaStock === "agotados" ? "#F7F3EC" : "#5B4E5E", border: "1px solid #D9D0C2" }}>
            Agotados ({agotados.length} productos)
          </button>
        </div>

        {mostrarNuevo && (
          <form onSubmit={crearProducto} className="p-3 mb-3 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
            <input value={nuevo.code} onChange={(e) => setNuevo({ ...nuevo, code: e.target.value })} placeholder="Código" required
              className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
            <input value={nuevo.name} onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })} placeholder="Descripción" required
              className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
            <select value={nuevo.category_id} onChange={(e) => setNuevo({ ...nuevo, category_id: e.target.value })}
              className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
              <option value="">Categoría (opcional)</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Cantidad inicial en inventario</p>
            <input type="number" min={0} value={nuevo.stock_physical} onChange={(e) => setNuevo({ ...nuevo, stock_physical: Number(e.target.value) })}
              className="w-full mb-2 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />

            {verPrecios && (
              <div className="flex gap-2 mb-2">
                <div className="w-1/2">
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Costo (Bs)</p>
                  <input type="number" value={nuevo.cost} onChange={(e) => setNuevo({ ...nuevo, cost: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                </div>
                <div className="w-1/2">
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Precio de venta (Bs)</p>
                  <input type="number" value={nuevo.price} onChange={(e) => setNuevo({ ...nuevo, price: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                </div>
              </div>
            )}

            <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Imagen del producto</p>
            <div className="flex items-center gap-2 mb-2">
              {nuevo.image_url ? (
                <img src={nuevo.image_url} alt="" className="w-12 h-12 rounded object-cover" />
              ) : (
                <div className="w-12 h-12 rounded flex items-center justify-center" style={{ background: "#EDE7DE" }}>
                  <ImageIcon size={16} style={{ color: "#5B4E5E" }} />
                </div>
              )}
              <label className="flex-1 text-xs px-3 py-2 rounded-md cursor-pointer text-center" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C", color: "#7A5F2D" }}>
                {subiendo ? "Subiendo…" : "Cargar imagen"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && subirImagenNuevo(e.target.files[0])} />
              </label>
            </div>

            <button type="submit" className="text-xs px-3 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Crear producto</button>
          </form>
        )}

        <div ref={listaRef} className="overflow-y-auto" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2", maxHeight: "62vh" }}>
          {lista.map((p, i) => (
            <button key={p.id} data-product-id={p.id} onClick={() => setSeleccionadoId(p.id)} className="w-full text-left px-3.5 py-2.5 flex items-center justify-between"
              style={{ background: seleccionadoId === p.id ? "#EDE7DE" : "transparent", borderBottom: i < lista.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <span className="text-sm">{p.name}</span>
              <span className="text-xs" style={{ color: "#5B4E5E" }}>{p.code}</span>
            </button>
          ))}
          {lista.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Ningún producto coincide con la búsqueda.</p>}
        </div>
      </div>

      <div className="md:col-span-2">
        {seleccionado && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); guardar(); }} className="p-4" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}> 
              <div className="flex items-center justify-between mb-3">
                <p className="font-serif text-lg flex items-center gap-2"><Pencil size={15} /> Editar producto</p>
                <div className="flex gap-1.5">
                  <button type="submit" disabled={guardando} className="text-xs px-3 py-1.5 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>{guardando ? "Guardando..." : "Guardar (Enter)"}</button>
                  <button type="button" onClick={cancelar} className="text-xs px-3 py-1.5 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>Cancelar</button>
                  <button type="button" onClick={eliminarProducto} className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5" style={{ background: "#F4E3E6", color: "#7A2540" }}>
                    <Trash2 size={13} /> Eliminar
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 mb-3">
                {form.image_url ? (
                  <img src={form.image_url} alt="" className="w-16 h-16 rounded object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded flex items-center justify-center" style={{ background: "#EDE7DE" }}>
                    <ImageIcon size={20} style={{ color: "#5B4E5E" }} />
                  </div>
                )}
                <label className="text-xs px-3 py-2 rounded-md cursor-pointer" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C", color: "#7A5F2D" }}>
                  {subiendo ? "Subiendo…" : "Cambiar imagen"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && subirImagenEditar(e.target.files[0])} />
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Código</p>
                  <input value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="w-full px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                </div>
                <Campo label="Cantidad física en inventario">
                  <input type="number" value={form.stock_physical ?? 0} onChange={(e) => setForm({ ...form, stock_physical: Number(e.target.value) })}
                    className="w-full bg-transparent outline-none" />
                </Campo>
                <div className="sm:col-span-2">
                  <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Descripción</p>
                  <input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
                </div>
                {verPrecios ? (
                  <>
                    <Campo label="Costo (Bs)">
                      <input type="number" value={form.cost ?? 0} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} className="w-full bg-transparent outline-none" />
                    </Campo>
                    <Campo label="Precio de venta (Bs)">
                      <input type="number" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} className="w-full bg-transparent outline-none" />
                    </Campo>
                  </>
                ) : (
                  <div className="sm:col-span-2 text-xs px-3 py-2 rounded" style={{ background: "#F6EAD2", color: "#7A5F2D" }}>
                    Costo y precio de venta no están disponibles para tu rol.
                  </div>
                )}
              </div>
              {verPrecios && (
                <div className="mt-3 flex justify-between text-sm px-1">
                  <span style={{ color: "#5B4E5E" }}>Margen por unidad</span>
                  <span className="font-serif" style={{ color: "#4F6F52" }}>Bs {(form.price ?? 0) - (form.cost ?? 0)}</span>
                </div>
              )}
            </form>

            {verPrecios && historial.length > 0 && (
              <div className="p-4 mt-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                <p className="font-serif text-base mb-2 flex items-center gap-2"><History size={15} style={{ color: "#5B4E5E" }} /> Historial de precios</p>
                {historial.map((h, i) => (
                  <div key={i} className="flex justify-between text-sm py-1" style={{ borderBottom: i < historial.length - 1 ? "1px solid #D9D0C2" : "none" }}>
                    <span>Bs {h.price}</span>
                    <span style={{ color: "#5B4E5E" }}>
                      {new Date(h.valid_from).toLocaleDateString("es-BO")} — {h.valid_to ? new Date(h.valid_to).toLocaleDateString("es-BO") : "Vigente"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>{label}</p>
      <div className="px-3 py-2 rounded text-sm" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>{children}</div>
    </div>
  );
}

