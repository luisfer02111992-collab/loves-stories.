import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, AlertTriangle, Search, Camera } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import type { Product, Category } from "../lib/types";

interface FilaExcel {
  code: string;
  name: string;
  category?: string;
  quantity: number;
  precioTotal: number;
  price: number;
  cost: number;
  image_url?: string;
}

interface Duplicado extends FilaExcel {
  existente: Product;
  cantidadACargar: number;
  precioACargar: number;
  decision: "revisar" | "manual" | "omitir";
}

// Normaliza encabezados: sin tildes, minúsculas, sin espacios extra — así "Código", "codigo", "CÓDIGO " calzan igual.
function normalizarClave(k: string) {
  return k
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

function buscarValor(fila: Record<string, any>, ...alias: string[]) {
  const mapa: Record<string, any> = {};
  Object.keys(fila).forEach((k) => (mapa[normalizarClave(k)] = fila[k]));
  for (const a of alias) {
    if (mapa[a] !== undefined && mapa[a] !== "") return mapa[a];
  }
  return "";
}

export default function Inventario() {
  const [productos, setProductos] = useState<Product[]>([]);
  const [categorias, setCategorias] = useState<Category[]>([]);
  const [filtroLote, setFiltroLote] = useState<string>("Todos");
  const [busqueda, setBusqueda] = useState("");
  const [buscarFoto, setBuscarFoto] = useState(false);
  const [duplicados, setDuplicados] = useState<Duplicado[] | null>(null);
  const [nuevos, setNuevos] = useState<FilaExcel[]>([]);
  const [mostrarMerma, setMostrarMerma] = useState(false);
  const [mermaCodigo, setMermaCodigo] = useState("");
  const [mermaCantidad, setMermaCantidad] = useState(1);
  const [mermaMotivo, setMermaMotivo] = useState("Dañado");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cargar();
    supabase.from("categories").select("*").order("sort_order").then(({ data }) => setCategorias((data as Category[]) ?? []));
  }, []);

  async function cargar() {
    const { data } = await supabase.from("products").select("*").is("deleted_at", null).order("name");
    setProductos((data as Product[]) ?? []);
    if (data && data.length > 0) setMermaCodigo((data[0] as Product).code);
  }

  function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target?.result, { type: "binary" });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      const filas: any[] = XLSX.utils.sheet_to_json(hoja, { defval: "" });
      const parseadas: FilaExcel[] = filas
        .map((f) => {
          const code = String(buscarValor(f, "codigo")).trim();
          const name = String(buscarValor(f, "descripcion")).trim();
          const quantity = Number(buscarValor(f, "cantidad")) || 0;
          const precioTotal = Number(buscarValor(f, "precio total", "preciototal")) || 0;
          const price = Number(buscarValor(f, "precio de venta", "preciodeventa", "precioventa")) || 0;
          const image_url = String(buscarValor(f, "imagen", "imagen url", "foto")).trim();
          const category = String(buscarValor(f, "categoria")).trim();
          return {
            code,
            name,
            category,
            quantity,
            precioTotal,
            price,
            cost: quantity > 0 ? Math.round((precioTotal / quantity) * 100) / 100 : 0,
            image_url: image_url || undefined,
          };
        })
        .filter((f) => f.code);

      const existentesPorCodigo = new Map<string, Product>(productos.map((p) => [p.code, p] as [string, Product]));
      const dup: Duplicado[] = [];
      const nue: FilaExcel[] = [];
      parseadas.forEach((f) => {
        const existente = existentesPorCodigo.get(f.code);
        if (existente) {
          dup.push({ ...f, existente, cantidadACargar: f.quantity ?? 0, precioACargar: f.price ?? existente.price, decision: "revisar" });
        } else {
          nue.push(f);
        }
      });
      setDuplicados(dup);
      setNuevos(nue);
    };
    reader.readAsBinaryString(file);
  }

  async function confirmarCarga() {
    const loteLabel = `Lote ${new Date().toLocaleDateString("es-BO")}`;
    const { data: lote } = await supabase
      .from("purchase_batches")
      .insert({
        label: loteLabel,
        source: "excel",
        total_detected: (duplicados?.length ?? 0) + nuevos.length,
        total_ok: nuevos.length,
        total_errors: 0,
        original_data: { nuevos, duplicados },
      })
      .select()
      .single();

    if (nuevos.length > 0) {
      const categoriaPorNombre = new Map(categorias.map((c) => [c.name.toLowerCase(), c.id]));
      const filas = nuevos.map((f) => ({
        code: f.code,
        name: f.name,
        category_id: f.category ? categoriaPorNombre.get(f.category.toLowerCase()) ?? null : null,
        cost: f.cost ?? 0,
        price: f.price ?? 0,
        stock_physical: f.quantity ?? 0,
        image_url: f.image_url ?? null,
        batch_id: lote?.id ?? null,
      }));
      await supabase.from("products").insert(filas);
    }

    for (const d of duplicados ?? []) {
      if (d.decision !== "manual") continue;
      await supabase.from("inventory_movements").insert({
        product_id: d.existente.id,
        type: "entrada",
        quantity_delta: d.cantidadACargar,
        reason: "Carga manual de lote con código repetido",
      });
      await supabase
        .from("products")
        .update({
          stock_physical: d.existente.stock_physical + d.cantidadACargar,
          price: d.precioACargar,
          image_url: d.image_url ?? d.existente.image_url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", d.existente.id);
    }

    setDuplicados(null);
    setNuevos([]);
    if (fileRef.current) fileRef.current.value = "";
    cargar();
  }

  async function registrarMerma() {
    const producto = productos.find((p) => p.code === mermaCodigo);
    if (!producto) return;
    await supabase.rpc("registrar_merma", { p_product_id: producto.id, p_quantity: mermaCantidad, p_motivo: mermaMotivo });
    setMostrarMerma(false);
    setMermaCantidad(1);
    cargar();
  }

  const lotes = ["Todos", ...Array.from(new Set(productos.map((p) => p.batch_id).filter(Boolean)))] as string[];
  const listaPorLote = filtroLote === "Todos" ? productos : productos.filter((p) => p.batch_id === filtroLote);
  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return listaPorLote;
    return listaPorLote.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }, [listaPorLote, busqueda]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Inventario</p>
        <div className="flex gap-2">
          <button onClick={() => setMostrarMerma(true)} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#F4E3E6", color: "#7A2540" }}>
            <AlertTriangle size={13} /> Registrar merma
          </button>
          <label className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5 cursor-pointer" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
            <Upload size={13} /> Cargar lote (Excel)
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onArchivo} />
          </label>
        </div>
      </div>
      <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>
        Columnas del Excel, en este orden: <strong>Código, Descripción, Cantidad, Precio total, Precio de venta, Imagen</strong>.
        "Precio total" es lo que costó esa cantidad en total (el costo unitario se calcula solo). "Imagen" puede ser un enlace directo a la foto.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded flex-1" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <Search size={14} style={{ color: "#5B4E5E" }} />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por código o descripción…"
            className="flex-1 text-sm outline-none bg-transparent" />
        </div>
        <button onClick={() => setBuscarFoto((v) => !v)} title="Buscar por similitud de imagen"
          className="w-10 h-10 rounded-md flex items-center justify-center shrink-0"
          style={{ background: buscarFoto ? "#B7791F" : "#F7F3EC", color: buscarFoto ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>
          <Camera size={16} />
        </button>
      </div>

      {buscarFoto && (
        <div className="p-3 mb-3 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <label className="flex items-center gap-2 px-3 py-3 rounded mb-2 cursor-pointer justify-center text-sm" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C", color: "#7A5F2D" }}>
            <Camera size={16} /> Tomar o subir foto del producto
            <input type="file" accept="image/*" capture="environment" className="hidden" />
          </label>
          <p className="text-xs" style={{ color: "#5B4E5E" }}>
            La búsqueda por similitud de imagen todavía no está conectada a un servicio real de reconocimiento —
            cuando definamos ese servicio, aquí aparecerán los productos con foto más parecidos a la que subas.
          </p>
        </div>
      )}

      {mostrarMerma && (
        <div className="p-4 mb-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="font-serif text-base mb-2">Registrar merma</p>
          <div className="grid sm:grid-cols-3 gap-2 mb-2">
            <select value={mermaCodigo} onChange={(e) => setMermaCodigo(e.target.value)} className="px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
              {productos.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
            </select>
            <input type="number" min={1} value={mermaCantidad} onChange={(e) => setMermaCantidad(Math.max(1, Number(e.target.value)))} className="px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
            <select value={mermaMotivo} onChange={(e) => setMermaMotivo(e.target.value)} className="px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
              <option>Dañado</option><option>Perdido</option><option>Robado</option><option>Otro</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={registrarMerma} className="text-xs px-3 py-2 rounded-md" style={{ background: "#7A2540", color: "#F7F3EC" }}>Registrar</button>
            <button onClick={() => setMostrarMerma(false)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>Cancelar</button>
          </div>
        </div>
      )}

      {duplicados !== null && (
        <div className="rounded-md p-4 mb-3" style={{ background: "#F7F3EC", border: "2px solid #B7791F" }}>
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle size={18} style={{ color: "#7A5F2D" }} className="mt-0.5" />
            <div>
              <p className="font-serif text-base">Aviso: se encontraron códigos ya existentes</p>
              <p className="text-xs" style={{ color: "#5B4E5E" }}>
                {nuevos.length} son nuevos (se cargarán directo) · {duplicados.length} ya existen. Ninguno de estos se modifica solo — revisa cada uno.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {duplicados.map((d, idx) => (
              <div key={d.code} className="p-3 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm">{d.code} · {d.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#F6EAD2", color: "#7A5F2D" }}>Código repetido</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                  <div className="p-2 rounded" style={{ background: "#F7F3EC" }}>
                    <p style={{ color: "#5B4E5E" }}>Ya existe</p>
                    <p>Cantidad: {d.existente.stock_physical}</p>
                    <p>Precio: Bs {d.existente.price}</p>
                  </div>
                  <div className="p-2 rounded" style={{ background: "#E4EBE1" }}>
                    <p style={{ color: "#4F6F52" }}>Viene en el Excel</p>
                    <p>Cantidad: {d.quantity}</p>
                    <p>Precio: Bs {d.price}</p>
                  </div>
                </div>
                <div className="flex items-end gap-2 mb-2">
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Cantidad a cargar</p>
                    <input type="number" value={d.cantidadACargar} onChange={(e) => {
                      const v = Number(e.target.value);
                      setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, cantidadACargar: v } : x)));
                    }} className="w-24 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Precio a cargar</p>
                    <input type="number" value={d.precioACargar} onChange={(e) => {
                      const v = Number(e.target.value);
                      setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, precioACargar: v } : x)));
                    }} className="w-24 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, decision: "manual" } : x)))}
                    className="text-xs px-3 py-1.5 rounded-md" style={{ background: d.decision === "manual" ? "#9C7A3C" : "#F7F3EC", color: d.decision === "manual" ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>
                    Cargar como registro manual aparte
                  </button>
                  <button onClick={() => setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, decision: "omitir" } : x)))}
                    className="text-xs px-3 py-1.5 rounded-md" style={{ background: d.decision === "omitir" ? "#F4E3E6" : "#F7F3EC", color: d.decision === "omitir" ? "#7A2540" : "#2B1E2E", border: "1px solid #D9D0C2" }}>
                    Omitir este código
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={confirmarCarga} className="text-xs px-4 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
              Confirmar carga ({nuevos.length} nuevos + revisados)
            </button>
            <button onClick={() => { setDuplicados(null); setNuevos([]); }} className="text-xs px-4 py-2 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1.5 mb-3">
        {lotes.map((l) => (
          <button key={l} onClick={() => setFiltroLote(l)} className="text-xs px-3 py-1.5 rounded-md" style={{ background: filtroLote === l ? "#9C7A3C" : "#F7F3EC", color: filtroLote === l ? "#F7F3EC" : "#5B4E5E", border: "1px solid #D9D0C2" }}>
            {l === "Todos" ? "Todos" : "Lote"}
          </button>
        ))}
      </div>

      <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <div className="grid grid-cols-4 px-3.5 py-2 text-xs" style={{ color: "#5B4E5E", borderBottom: "1px solid #D9D0C2" }}>
          <span>Código</span><span>Descripción</span><span>Disponible</span><span>Precio</span>
        </div>
        {lista.map((p, i) => (
          <div key={p.id} className="grid grid-cols-4 px-3.5 py-2.5 text-sm items-center" style={{ borderBottom: i < lista.length - 1 ? "1px solid #D9D0C2" : "none" }}>
            <span style={{ color: "#5B4E5E" }}>{p.code}</span>
            <span>{p.name}</span>
            <span style={{ color: p.stock_available < 6 ? "#7A2540" : "#2B1E2E" }}>{p.stock_available}</span>
            <span className="font-serif">Bs {p.price}</span>
          </div>
        ))}
        {lista.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Ningún producto coincide con la búsqueda.</p>}
      </div>
    </div>
  );
}
