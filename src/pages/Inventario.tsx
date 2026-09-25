import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, AlertTriangle, Search, Camera, Image as ImageIcon, Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabase";
import CamaraCaptura from "../components/CamaraCaptura";
import type { Product, Category } from "../lib/types";

interface FilaExcel {
  fila: number;
  code: string;
  name: string;
  category?: string;
  quantity: number;
  price: number;
  cost: number;
  image_url?: string;
  error?: string;
}

interface Duplicado extends FilaExcel {
  existente: Product;
  cantidadACargar: number;
  precioACargar: number;
  codigoACargar: string;
  nombreACargar: string;
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
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [fotoBusqueda, setFotoBusqueda] = useState<string | null>(null);
  const [duplicados, setDuplicados] = useState<Duplicado[] | null>(null);
  const [nuevos, setNuevos] = useState<FilaExcel[]>([]);
  const [conError, setConError] = useState<FilaExcel[]>([]);
  const [resumenCarga, setResumenCarga] = useState<{ importados: number; conError: number; stockAgregado: number } | null>(null);
  const [cargandoLote, setCargandoLote] = useState(false);
  const [progresoCarga, setProgresoCarga] = useState("");
  const [pestanaStock, setPestanaStock] = useState<"disponibles" | "agotados">("disponibles");
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
    // Supabase limita por defecto cada consulta a 1.000 filas. El inventario actual
    // supera ese límite, así que cargamos por páginas para que los conteos y las
    // listas representen TODO el inventario.
    const todas: Product[] = [];
    const TAMANO_PAGINA = 1000;
    for (let desde = 0; ; desde += TAMANO_PAGINA) {
      const { data, error } = await supabase
        .from("products")
        .select("*, purchase_batches(label)")
        .is("deleted_at", null)
        .order("name")
        .range(desde, desde + TAMANO_PAGINA - 1);
      if (error) {
        console.error("Error cargando inventario:", error);
        break;
      }
      const pagina = (data as Product[]) ?? [];
      todas.push(...pagina);
      if (pagina.length < TAMANO_PAGINA) break;
    }
    setProductos(todas);
    if (todas.length > 0) setMermaCodigo(todas[0].code);
  }

  async function exportarInventario() {
    const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet("Inventario");
    ws.columns=[
      {header:"Código",key:"codigo",width:14},{header:"Descripción",key:"descripcion",width:28},{header:"Costo",key:"costo",width:13},
      {header:"Precio de venta",key:"precio",width:16},{header:"Ganancia",key:"ganancia",width:14},{header:"Stock físico",key:"fisico",width:13},
      {header:"Stock reservado",key:"reservado",width:15},{header:"Stock disponible",key:"disponible",width:15},{header:"Lote",key:"lote",width:22},
      {header:"Imagen",key:"imagen",width:18},{header:"Estado",key:"estado",width:14}
    ];
    ws.getRow(1).font={bold:true}; ws.views=[{state:"frozen",ySplit:1}]; ws.autoFilter={from:"A1",to:"K1"};
    for (const x of productos as any[]) {
      const row=ws.addRow({codigo:x.code,descripcion:x.description || x.name,costo:Number(x.cost||0),precio:Number(x.price||0),ganancia:Number(x.price||0)-Number(x.cost||0),fisico:Number(x.stock_physical||0),reservado:Number(x.stock_reserved||0),disponible:Number(x.stock_available||0),lote:x.purchase_batches?.label || "",imagen:"",estado:Number(x.stock_available||0)>0?"Disponible":"Agotado"});
      row.height=58;
      if(x.image_url){ try { const r=await fetch(x.image_url); if(r.ok){ const blob=await r.blob(); const ext=(blob.type.includes("png")?"png":"jpeg") as "png"|"jpeg"; const base64=await new Promise<string>((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result));fr.onerror=()=>reject(fr.error);fr.readAsDataURL(blob);}); const imageId=wb.addImage({base64,extension:ext}); ws.addImage(imageId,{tl:{col:9.15,row:row.number-0.9},ext:{width:62,height:62}}); } } catch {} }
    }
    [3,4,5].forEach(c=>ws.getColumn(c).numFmt='"Bs" #,##0.00');
    const buffer=await wb.xlsx.writeBuffer(); const blob=new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`Inventario-Loves-Stories-${new Date().toISOString().slice(0,10)}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
  }

  function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target?.result, { type: "binary" });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      const filas: any[] = XLSX.utils.sheet_to_json(hoja, { defval: "" });
      const errores: FilaExcel[] = [];
      const parseadas: FilaExcel[] = [];

      filas.forEach((f, idx) => {
        const numeroFila = idx + 2; // +2: fila 1 es el encabezado en el Excel
        const code = String(buscarValor(f, "codigo")).trim();
        const name = String(buscarValor(f, "descripcion")).trim();
        const quantity = Number(buscarValor(f, "cantidad", "disponible"));
        const costoDirecto = buscarValor(f, "costo");
        const price = Number(buscarValor(f, "precio de venta", "preciodeventa", "precioventa"));
        const image_url = String(buscarValor(f, "imagen", "imagen url", "foto")).trim();
        const category = String(buscarValor(f, "categoria")).trim();

        if (!code && !name && !quantity && !price) return; // fila totalmente vacía, se ignora sin marcar error

        const problemas: string[] = [];
        if (!code) problemas.push("falta el código");
        if (!name) problemas.push("falta la descripción");
        if (!Number.isFinite(quantity) || quantity < 0) problemas.push("cantidad inválida");
        if (!Number.isFinite(price) || price < 0) problemas.push("precio de venta inválido");
        const cost = Number(costoDirecto);
        if (costoDirecto === "" || !Number.isFinite(cost) || cost < 0) problemas.push("costo inválido");

        const fila: FilaExcel = {
          fila: numeroFila,
          code, name, category,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          price: Number.isFinite(price) ? price : 0,
          cost,
          image_url: image_url || undefined,
        };

        if (problemas.length > 0) {
          errores.push({ ...fila, error: `Fila ${numeroFila}: ${problemas.join(", ")}` });
        } else {
          parseadas.push(fila);
        }
      });

      const existentesPorCodigo = new Map<string, Product>(productos.map((p) => [p.code, p] as [string, Product]));
      const dup: Duplicado[] = [];
      const nue: FilaExcel[] = [];
      parseadas.forEach((f) => {
        const existente = existentesPorCodigo.get(f.code);
        if (existente) {
          dup.push({
            ...f, existente,
            cantidadACargar: f.quantity ?? 0,
            precioACargar: f.price ?? existente.price,
            codigoACargar: existente.code,
            nombreACargar: existente.name,
            decision: "revisar",
          });
        } else {
          nue.push(f);
        }
      });
      setDuplicados(dup);
      setNuevos(nue);
      setConError(errores);
      setResumenCarga(null);
    };
    reader.readAsBinaryString(file);
  }

  async function confirmarCarga() {
    if (cargandoLote) return;
    setCargandoLote(true);
    setProgresoCarga("Creando lote...");
    try {
      const loteLabel = `Lote ${new Date().toLocaleDateString("es-BO")}`;
      const { data: lote, error: loteError } = await supabase
        .from("purchase_batches")
        .insert({
          label: loteLabel,
          source: "excel",
          total_detected: (duplicados?.length ?? 0) + nuevos.length + conError.length,
          total_ok: 0,
          total_errors: conError.length,
          // Evitamos guardar el Excel completo aquí: con cientos de filas hacía lenta la confirmación.
          original_data: { archivo: "excel", total_filas: (duplicados?.length ?? 0) + nuevos.length + conError.length },
        })
        .select("id")
        .single();

      if (loteError || !lote) throw new Error(`No se pudo crear el lote: ${loteError?.message ?? "error desconocido"}`);

      let stockAgregado = 0;
      let importados = 0;
      const erroresGuardado: FilaExcel[] = [...conError];
      const categoriaPorNombre = new Map(categorias.map((c) => [c.name.toLowerCase(), c.id]));

      // Los códigos clasificados como nuevos pueden corresponder a productos eliminados.
      // UPSERT por código los restaura y, al procesar en bloques, evita cientos de llamadas consecutivas.
      const TAMANO_BLOQUE = 50;
      for (let i = 0; i < nuevos.length; i += TAMANO_BLOQUE) {
        const bloque = nuevos.slice(i, i + TAMANO_BLOQUE);
        setProgresoCarga(`Guardando productos ${i + 1}-${Math.min(i + bloque.length, nuevos.length)} de ${nuevos.length}...`);
        const payloads = bloque.map((f) => ({
          code: f.code,
          name: f.name,
          category_id: f.category ? categoriaPorNombre.get(f.category.toLowerCase()) ?? null : null,
          cost: f.cost,
          price: f.price,
          stock_physical: f.quantity,
          stock_reserved: 0,
          image_url: f.image_url || null,
          batch_id: lote.id,
          active: true,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        }));
        const { data: guardados, error } = await supabase
          .from("products")
          .upsert(payloads, { onConflict: "code" })
          .select("code");
        if (error) {
          for (const f of bloque) erroresGuardado.push({ ...f, error: `Fila ${f.fila}: no se guardó (${error.message})` });
        } else {
          const codigosOk = new Set((guardados ?? []).map((x: any) => String(x.code)));
          for (const f of bloque) {
            if (codigosOk.has(f.code)) { importados++; stockAgregado += f.quantity; }
            else erroresGuardado.push({ ...f, error: `Fila ${f.fila}: Supabase no confirmó el guardado` });
          }
        }
      }

      const revisados = (duplicados ?? []).filter((d) => d.decision === "manual");
      for (let i = 0; i < revisados.length; i++) {
        const d = revisados[i];
        setProgresoCarga(`Actualizando código repetido ${i + 1} de ${revisados.length}...`);
        const { error: updError } = await supabase.from("products").update({
          code: d.codigoACargar || d.existente.code,
          name: d.nombreACargar || d.existente.name,
          stock_physical: d.existente.stock_physical + d.cantidadACargar,
          price: d.precioACargar,
          cost: d.cost,
          image_url: d.image_url || d.existente.image_url || null,
          batch_id: lote.id,
          active: true,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        }).eq("id", d.existente.id).select("id").single();
        if (updError) erroresGuardado.push({ ...d, error: `Fila ${d.fila}: no se actualizó (${updError.message})` });
        else {
          await supabase.from("inventory_movements").insert({ product_id: d.existente.id, type: "entrada", quantity_delta: d.cantidadACargar, reason: "Carga de lote Excel" });
          stockAgregado += d.cantidadACargar;
          importados++;
        }
      }

      await supabase.from("purchase_batches").update({ total_ok: importados, total_errors: erroresGuardado.length }).eq("id", lote.id);

      setProgresoCarga("Verificando inventario guardado...");
      const { data: verificados, error: verError } = await supabase.from("products").select("id,code,stock_physical").eq("batch_id", lote.id).is("deleted_at", null);
      if (verError) throw new Error(`El lote se procesó, pero no se pudo verificar: ${verError.message}`);
      if (importados > 0 && (verificados?.length ?? 0) === 0) throw new Error("Supabase no confirmó ningún producto del lote. No se mostrará una carga exitosa.");

      setResumenCarga({ importados, conError: erroresGuardado.length, stockAgregado });
      setConError(erroresGuardado);
      setDuplicados(null);
      setNuevos([]);
      if (fileRef.current) fileRef.current.value = "";
      await cargar();
      setProgresoCarga(`Listo: ${importados} producto(s) guardado(s) y ${stockAgregado} unidad(es) cargadas.`);
    } catch (e: any) {
      const mensaje = e?.message || "Error desconocido al cargar el lote";
      setProgresoCarga(`ERROR: ${mensaje}`);
      alert(mensaje);
    } finally {
      setCargandoLote(false);
    }
  }

  async function eliminarProductoExistente(id: string) {
    if (!confirm("¿Eliminar este producto existente? Podrás restaurarlo luego desde la Papelera.")) return;
    await supabase.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    setDuplicados((prev) => prev?.filter((d) => d.existente.id !== id) ?? null);
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
  const q = busqueda.trim().toLowerCase();
  const coincideBusqueda = (p: Product) => !q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
  // La búsqueda se aplica ANTES de separar en pestañas, así un código
  // agotado también aparece — solo hay que mirar la pestaña "Agotados".
  const disponibles = listaPorLote.filter((p) => p.stock_available > 0 && coincideBusqueda(p));
  const agotados = listaPorLote.filter((p) => p.stock_available <= 0 && coincideBusqueda(p));
  const lista = pestanaStock === "disponibles" ? disponibles : agotados;
  const unidadesDisponibles = disponibles.reduce((total, p) => total + Number(p.stock_available || 0), 0);
  const unidadesAgotadas = agotados.reduce((total, p) => total + Number(p.stock_available || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-serif text-lg">Inventario</p>
        <div className="flex gap-2">
          <a href="/PLANTILLA_CARGA_INVENTARIO_LOVES_STORIES.xlsx" download className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}><FileSpreadsheet size={13}/> Descargar plantilla</a>
          <button onClick={exportarInventario} className="text-xs px-3 py-2 rounded-md flex items-center gap-1.5" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}><Download size={13}/> Exportar Excel</button>
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
        Usa <strong>Descargar plantilla</strong> para obtener el Excel editable de ejemplo. Columnas: <strong>Código, Descripción, Cantidad, Costo, Precio de venta, Imagen y Categoría</strong>.
        <strong>Imagen es opcional:</strong> el lote se carga normalmente con o sin foto. Si tienes una imagen, puedes colocar su enlace en la columna Imagen. Categoría también es opcional.
      </p>

      {resumenCarga && (
        <div className="p-3 mb-3 rounded-md flex gap-4" style={{ background: "#E4EBE1", border: "1px solid #4F6F52" }}>
          <p className="text-xs" style={{ color: "#4F6F52" }}><strong>{resumenCarga.importados}</strong> productos importados/actualizados</p>
          <p className="text-xs" style={{ color: resumenCarga.conError > 0 ? "#7A2540" : "#4F6F52" }}><strong>{resumenCarga.conError}</strong> con error</p>
          <p className="text-xs" style={{ color: "#4F6F52" }}><strong>{resumenCarga.stockAgregado}</strong> unidades de stock agregadas</p>
        </div>
      )}

      {conError.length > 0 && (
        <div className="p-3 mb-3 rounded-md" style={{ background: "#F4E3E6", border: "1px solid #7A2540" }}>
          <p className="text-xs mb-1.5" style={{ color: "#7A2540" }}>{conError.length} fila(s) del Excel no se importaron:</p>
          {conError.map((e, i) => (
            <p key={i} className="text-xs" style={{ color: "#7A2540" }}>{e.error}</p>
          ))}
        </div>
      )}


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
          {fotoBusqueda ? (
            <div className="flex items-center gap-3 mb-2">
              <img src={fotoBusqueda} alt="Foto tomada" className="w-16 h-16 rounded object-cover" />
              <button onClick={() => setFotoBusqueda(null)} className="text-xs px-3 py-1.5 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
                Tomar otra foto
              </button>
            </div>
          ) : (
            <div className="flex gap-2 mb-2">
              <button onClick={() => setMostrarCamara(true)} className="flex-1 flex items-center gap-2 px-3 py-3 rounded justify-center text-sm" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C", color: "#7A5F2D" }}>
                <Camera size={16} /> Abrir cámara
              </button>
              <label className="flex-1 flex items-center gap-2 px-3 py-3 rounded justify-center text-sm cursor-pointer" style={{ background: "#EDE7DE", border: "1px dashed #9C7A3C", color: "#7A5F2D" }}>
                <ImageIcon size={16} /> Subir foto
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFotoBusqueda(URL.createObjectURL(f));
                }} />
              </label>
            </div>
          )}
          <p className="text-xs" style={{ color: "#5B4E5E" }}>
            La búsqueda por similitud de imagen todavía no está conectada a un servicio real de reconocimiento —
            cuando definamos ese servicio, aquí aparecerán los productos con foto más parecidos a la que subas.
            La cámara y la foto ya funcionan de verdad (pide permiso, muestra la vista previa y captura la imagen).
          </p>
        </div>
      )}

      {mostrarCamara && (
        <CamaraCaptura
          onCerrar={() => setMostrarCamara(false)}
          onCapturar={(file) => {
            setFotoBusqueda(URL.createObjectURL(file));
            setMostrarCamara(false);
          }}
        />
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
                    <p>Costo: Bs {d.existente.cost}</p>
                  </div>
                  <div className="p-2 rounded" style={{ background: "#E4EBE1" }}>
                    <p style={{ color: "#4F6F52" }}>Viene en el Excel</p>
                    <p>Cantidad: {d.quantity}</p>
                    <p>Precio: Bs {d.price}</p>
                    <p>Costo: Bs {d.cost}</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-2 mb-2">
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Código a guardar</p>
                    <input value={d.codigoACargar} onChange={(e) => {
                      const v = e.target.value;
                      setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, codigoACargar: v } : x)));
                    }} className="w-full px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Descripción a guardar</p>
                    <input value={d.nombreACargar} onChange={(e) => {
                      const v = e.target.value;
                      setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, nombreACargar: v } : x)));
                    }} className="w-full px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                </div>
                <div className="flex items-end gap-2 mb-2">
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Cantidad a sumar al stock</p>
                    <input type="number" value={d.cantidadACargar} onChange={(e) => {
                      const v = Number(e.target.value);
                      setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, cantidadACargar: v } : x)));
                    }} className="w-24 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Precio a guardar</p>
                    <input type="number" value={d.precioACargar} onChange={(e) => {
                      const v = Number(e.target.value);
                      setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, precioACargar: v } : x)));
                    }} className="w-24 px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, decision: "manual" } : x)))}
                    className="text-xs px-3 py-1.5 rounded-md" style={{ background: d.decision === "manual" ? "#9C7A3C" : "#F7F3EC", color: d.decision === "manual" ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>
                    Actualizar el producto existente con estos datos
                  </button>
                  <button onClick={() => setDuplicados((prev) => prev!.map((x, i) => (i === idx ? { ...x, decision: "omitir" } : x)))}
                    className="text-xs px-3 py-1.5 rounded-md" style={{ background: d.decision === "omitir" ? "#F4E3E6" : "#F7F3EC", color: d.decision === "omitir" ? "#7A2540" : "#2B1E2E", border: "1px solid #D9D0C2" }}>
                    Omitir este código
                  </button>
                  <button onClick={() => eliminarProductoExistente(d.existente.id)}
                    className="text-xs px-3 py-1.5 rounded-md" style={{ background: "#F4E3E6", color: "#7A2540", border: "1px solid #D9D0C2" }}>
                    Eliminar el producto existente (papelera)
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button disabled={cargandoLote} onClick={confirmarCarga} className="text-xs px-4 py-2 rounded-md disabled:opacity-60" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
              {cargandoLote ? "Procesando..." : `Confirmar carga (${nuevos.length} nuevos + revisados)`}
            </button>
            {progresoCarga && <span className="text-xs self-center" style={{ color: progresoCarga.startsWith("ERROR") ? "#7A2540" : "#4F6F52" }}>{progresoCarga}</span>}
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

      <div className="flex gap-1.5 mb-3">
        <button onClick={() => setPestanaStock("disponibles")} className="text-xs px-3 py-1.5 rounded-md"
          style={{ background: pestanaStock === "disponibles" ? "#4F6F52" : "#F7F3EC", color: pestanaStock === "disponibles" ? "#F7F3EC" : "#5B4E5E", border: "1px solid #D9D0C2" }}>
          Disponibles ({disponibles.length} productos · {unidadesDisponibles} unidades)
        </button>
        <button onClick={() => setPestanaStock("agotados")} className="text-xs px-3 py-1.5 rounded-md"
          style={{ background: pestanaStock === "agotados" ? "#7A2540" : "#F7F3EC", color: pestanaStock === "agotados" ? "#F7F3EC" : "#5B4E5E", border: "1px solid #D9D0C2" }}>
          Agotados ({agotados.length} productos · {unidadesAgotadas} unidades)
        </button>
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
      {q && lista.length === 0 && ((pestanaStock === "disponibles" ? agotados : disponibles).length > 0) && (
        <p className="text-xs mt-2" style={{ color: "#7A5F2D" }}>
          No hay resultados en {pestanaStock === "disponibles" ? "Disponibles" : "Agotados"}, pero sí en{" "}
          <button onClick={() => setPestanaStock(pestanaStock === "disponibles" ? "agotados" : "disponibles")} className="underline">
            {pestanaStock === "disponibles" ? "Agotados" : "Disponibles"} ({(pestanaStock === "disponibles" ? agotados : disponibles).length})
          </button>.
        </p>
      )}
    </div>
  );
}
