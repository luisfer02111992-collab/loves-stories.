import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Search, Trash2, Upload, Save, X } from "lucide-react";

type VariantType = "ring_size" | "length_cm" | null;

interface Product {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  price: number;
  stock_available: number;
  active: boolean;
}

interface CatalogProduct {
  id: string;
  product_id: string;
  code: string;
  name: string;
  image_url: string | null;
  price: number;
  stock_available: number;
  active: boolean;
  variant_type: VariantType;
  variant_stock: Record<string, number> | null;
  display_description?: string | null;
}

export default function Catalogo() {
  const [items, setItems] = useState<CatalogProduct[]>([]);
  const [productos, setProductos] = useState<Product[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [productoSeleccionado, setProductoSeleccionado] =
    useState<Product | null>(null);

  const [cantidad, setCantidad] = useState(1);
  const [descripcion, setDescripcion] = useState("");
  const [variantType, setVariantType] = useState<VariantType>(null);
  const [variantStock, setVariantStock] = useState<Record<string, number>>({});
  const [subiendoId, setSubiendoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    // Supabase devuelve como máximo 1000 filas por consulta.
    // Como el inventario tiene miles de productos, cargamos TODAS las páginas.
    const inventario: Product[] = [];
    const TAMANO_PAGINA = 1000;

    for (let desde = 0; ; desde += TAMANO_PAGINA) {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, image_url, price, stock_available, active")
        .eq("active", true)
        .order("code")
        .range(desde, desde + TAMANO_PAGINA - 1);

      if (error) {
        console.error("Error cargando inventario:", error);
        return;
      }

      const pagina = (data as Product[]) ?? [];
      inventario.push(...pagina);

      if (pagina.length < TAMANO_PAGINA) break;
    }

    // Hacemos lo mismo con el catálogo para no perder publicaciones
    // si algún día supera las 1000 filas.
    const cat: CatalogProduct[] = [];

    for (let desde = 0; ; desde += TAMANO_PAGINA) {
      const { data, error } = await supabase
        .from("catalog_products")
        .select("*")
        .order("created_at", { ascending: false })
        .range(desde, desde + TAMANO_PAGINA - 1);

      if (error) {
        console.error("Error cargando catálogo:", error);
        return;
      }

      const pagina = (data as CatalogProduct[]) ?? [];
      cat.push(...pagina);

      if (pagina.length < TAMANO_PAGINA) break;
    }

    const stockInventarioPorId = new Map(
      inventario.map((p) => [p.id, Number(p.stock_available) || 0])
    );

    // Solo mostramos publicaciones activas cuyo producto todavía tiene stock real.
    const catalogoValido = cat.filter(
      (it) =>
        it.active &&
        (stockInventarioPorId.get(it.product_id) ?? 0) > 0
    );

    // Si el stock REAL llega a 0, retiramos ese modelo del catálogo.
    const agotadosActivos = cat.filter(
      (it) =>
        it.active &&
        stockInventarioPorId.has(it.product_id) &&
        (stockInventarioPorId.get(it.product_id) ?? 0) <= 0
    );

    if (agotadosActivos.length > 0) {
      const { error: errorAgotados } = await supabase
        .from("catalog_products")
        .update({
          active: false,
          stock_available: 0,
        })
        .in(
          "id",
          agotadosActivos.map((it) => it.id)
        );

      if (errorAgotados) {
        console.error(
          "Error retirando productos agotados del catálogo:",
          errorAgotados
        );
      }
    }

    setItems(catalogoValido);
    setProductos(inventario);
  }

  const resultados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    if (!texto) return [];

    return productos
      .filter((p) => {
        return (
          p.code.toLowerCase().includes(texto) ||
          p.name.toLowerCase().includes(texto)
        );
      })
      .slice(0, 20);
  }, [busqueda, productos]);

  function seleccionarProducto(producto: Product) {
    setProductoSeleccionado(producto);
    setBusqueda(producto.code);
    setCantidad(1);
    setDescripcion("");
    setVariantType(null);
    setVariantStock({});
  }

  function limpiarSeleccion() {
    setProductoSeleccionado(null);
    setBusqueda("");
    setCantidad(1);
    setDescripcion("");
    setVariantType(null);
    setVariantStock({});
  }

  function cambiarCantidadVariante(clave: string, valor: number) {
    const numero = Math.max(0, Number(valor) || 0);

    setVariantStock((prev) => ({
      ...prev,
      [clave]: numero,
    }));
  }

  const totalVariantes = useMemo(() => {
    return Object.values(variantStock).reduce(
      (total, valor) => total + (Number(valor) || 0),
      0
    );
  }, [variantStock]);

  async function guardarCatalogo() {
    if (!productoSeleccionado) {
      alert("Selecciona un producto.");
      return;
    }

    const stockInventario = Number(productoSeleccionado.stock_available) || 0;

    if (stockInventario <= 0) {
      alert("Este producto ya no tiene stock en inventario.");
      return;
    }

    let totalPublicado = Number(cantidad) || 0;

    if (variantType) {
      totalPublicado = totalVariantes;
    }

    if (totalPublicado <= 0) {
      alert("Debes publicar al menos 1 unidad.");
      return;
    }

    if (totalPublicado > stockInventario) {
      alert(
        `No puedes publicar ${totalPublicado} unidades. En inventario solo hay ${stockInventario}.`
      );
      return;
    }

    setGuardando(true);

    const existente = items.find(
      (it) => it.product_id === productoSeleccionado.id
    );

    const datos = {
      product_id: productoSeleccionado.id,
      code: productoSeleccionado.code,
      name: productoSeleccionado.name,
      image_url: productoSeleccionado.image_url,
      price: productoSeleccionado.price,
      stock_available: totalPublicado,
      active: true,
      variant_type: variantType,
      variant_stock: variantType ? variantStock : null,
      display_description: descripcion.trim() || null,
    };

    let error;

    if (existente) {
      const respuesta = await supabase
        .from("catalog_products")
        .update(datos)
        .eq("id", existente.id);

      error = respuesta.error;
    } else {
      const respuesta = await supabase
        .from("catalog_products")
        .insert(datos);

      error = respuesta.error;
    }

    setGuardando(false);

    if (error) {
      alert("ERROR: " + error.message);
      return;
    }

    await cargar();
    limpiarSeleccion();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function subirImagen(
    file: File,
    carpeta: string
  ): Promise<string | null> {
    try {
      const extension = file.name.split(".").pop() || "jpg";
      const nombre = `${carpeta}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(nombre, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error(uploadError);
        return null;
      }

      const { data } = supabase.storage
        .from("product-images")
        .getPublicUrl(nombre);

      return data.publicUrl;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async function subirImagenCatalogo(id: string, file: File) {
    setSubiendoId(id);

    const itemCatalogo = items.find((it) => it.id === id);

    if (!itemCatalogo) {
      setSubiendoId(null);
      alert("No se encontró el producto correspondiente.");
      return;
    }

    const url = await subirImagen(file, "catalogo");

    if (!url) {
      setSubiendoId(null);
      alert("No se pudo cargar la imagen.");
      return;
    }

    // IMPORTANTE:
    // esta imagen se cambia SOLO en el catálogo.
    // NO cambia la imagen original de Productos/Inventario.
    const { error } = await supabase
      .from("catalog_products")
      .update({
        image_url: url,
      })
      .eq("id", id);

    setSubiendoId(null);

    if (error) {
      alert("ERROR catálogo: " + error.message);
      return;
    }

    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              image_url: url,
            }
          : it
      )
    );

    alert("Imagen del catálogo actualizada correctamente.");
  }

  async function eliminar(id: string) {
    const confirmar = window.confirm(
      "¿Quieres retirar este producto del catálogo?"
    );

    if (!confirmar) return;

    const { error } = await supabase
      .from("catalog_products")
      .update({
        active: false,
        stock_available: 0,
      })
      .eq("id", id);

    if (error) {
      alert("ERROR: " + error.message);
      return;
    }

    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function abrirEdicion(item: CatalogProduct) {
    const producto = productos.find((p) => p.id === item.product_id);

    if (!producto) {
      alert("El producto ya no existe en inventario.");
      return;
    }

    setProductoSeleccionado(producto);
    setBusqueda(producto.code);
    setCantidad(Number(item.stock_available) || 0);
    setDescripcion(item.display_description || "");
    setVariantType(item.variant_type);
    setVariantStock(item.variant_stock || {});

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <h1
        className="text-2xl md:text-3xl font-semibold mb-5"
        style={{ color: "#7A0019" }}
      >
        Catálogo
      </h1>

      <div
        className="rounded-xl p-4 mb-6"
        style={{
          background: "#FAF7F2",
          border: "1px solid #E4D8C8",
        }}
      >
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "#9C7A3C" }}
              />

              <input
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);

                  if (
                    productoSeleccionado &&
                    e.target.value !== productoSeleccionado.code
                  ) {
                    setProductoSeleccionado(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && resultados.length > 0) {
                    e.preventDefault();
                    seleccionarProducto(resultados[0]);
                  }
                }}
                placeholder="Buscar producto por código o nombre..."
                className="w-full pl-10 pr-4 py-3 rounded-lg outline-none"
                style={{
                  border: "1px solid #D8C9B5",
                  background: "white",
                  color: "#6D0017",
                }}
              />
            </div>

            {productoSeleccionado && (
              <button
                type="button"
                onClick={limpiarSeleccion}
                className="px-3 rounded-lg"
                style={{
                  border: "1px solid #D8C9B5",
                  color: "#7A0019",
                }}
              >
                <X size={20} />
              </button>
            )}
          </div>

          {!productoSeleccionado &&
            busqueda.trim() &&
            resultados.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg overflow-hidden shadow-lg"
                style={{
                  background: "white",
                  border: "1px solid #D8C9B5",
                }}
              >
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => seleccionarProducto(p)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-stone-50"
                  >
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="w-12 h-12 rounded-md object-cover"
                      />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-md flex items-center justify-center text-xs"
                        style={{ background: "#EFE8DE" }}
                      >
                        Sin foto
                      </div>
                    )}

                    <div className="min-w-0">
                      <div
                        className="font-semibold"
                        style={{ color: "#7A0019" }}
                      >
                        {p.code}
                      </div>

                      <div className="text-sm truncate">{p.name}</div>

                      <div className="text-xs text-gray-500">
                        Stock inventario: {p.stock_available}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
        </div>

        {productoSeleccionado && (
          <div className="mt-5">
            <div className="flex gap-4 items-start">
              {productoSeleccionado.image_url ? (
                <img
                  src={productoSeleccionado.image_url}
                  alt={productoSeleccionado.name}
                  className="w-20 h-20 object-cover rounded-lg"
                />
              ) : (
                <div
                  className="w-20 h-20 rounded-lg flex items-center justify-center text-xs"
                  style={{ background: "#EFE8DE" }}
                >
                  Sin foto
                </div>
              )}

              <div>
                <div
                  className="font-semibold text-lg"
                  style={{ color: "#7A0019" }}
                >
                  {productoSeleccionado.name}
                </div>

                <div className="text-sm">
                  Código: {productoSeleccionado.code}
                </div>

                <div
                  className="font-semibold mt-1"
                  style={{ color: "#8A682C" }}
                >
                  Bs {productoSeleccionado.price}
                </div>

                <div className="text-sm mt-1">
                  Stock inventario: {productoSeleccionado.stock_available}
                </div>
              </div>
            </div>

            <div className="mt-5">
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: "#7A0019" }}
              >
                Tipo de publicación
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setVariantType(null);
                    setVariantStock({});
                  }}
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{
                    background:
                      variantType === null ? "#7A0019" : "#EFE8DE",
                    color: variantType === null ? "white" : "#7A0019",
                  }}
                >
                  Cantidad normal
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setVariantType("ring_size");

                    const inicial: Record<string, number> = {};

                    for (let talla = 5; talla <= 13; talla++) {
                      inicial[String(talla)] =
                        variantStock[String(talla)] || 0;
                    }

                    setVariantStock(inicial);
                  }}
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{
                    background:
                      variantType === "ring_size"
                        ? "#7A0019"
                        : "#EFE8DE",
                    color:
                      variantType === "ring_size" ? "white" : "#7A0019",
                  }}
                >
                  Tallas de anillo
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setVariantType("length_cm");
                    setVariantStock({});
                  }}
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{
                    background:
                      variantType === "length_cm"
                        ? "#7A0019"
                        : "#EFE8DE",
                    color:
                      variantType === "length_cm" ? "white" : "#7A0019",
                  }}
                >
                  Largo
                </button>
              </div>
            </div>

            {variantType === null && (
              <div className="mt-4">
                <label className="block text-sm mb-1">
                  Cantidad disponible en catálogo
                </label>

                <input
                  type="number"
                  min={0}
                  max={productoSeleccionado.stock_available}
                  value={cantidad}
                  onChange={(e) => setCantidad(Number(e.target.value))}
                  className="w-40 px-3 py-2 rounded-lg"
                  style={{ border: "1px solid #D8C9B5" }}
                />
              </div>
            )}

            {variantType === "ring_size" && (
              <div className="mt-5">
                <div className="flex justify-between mb-2">
                  <span
                    className="text-sm font-medium"
                    style={{ color: "#7A0019" }}
                  >
                    Cantidad por talla
                  </span>

                  <span className="text-sm">
                    Total: <b>{totalVariantes}</b>
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
                  {Array.from({ length: 9 }, (_, i) => i + 5).map(
                    (talla) => (
                      <div
                        key={talla}
                        className="p-2 rounded-lg text-center"
                        style={{
                          background: "#EFE8DE",
                          border: "1px solid #D8C9B5",
                        }}
                      >
                        <div className="text-xs mb-1">
                          Talla {talla}
                        </div>

                        <input
                          type="number"
                          min={0}
                          value={variantStock[String(talla)] || 0}
                          onChange={(e) =>
                            cambiarCantidadVariante(
                              String(talla),
                              Number(e.target.value)
                            )
                          }
                          className="w-full text-center rounded-md py-1"
                          style={{
                            border: "1px solid #D8C9B5",
                          }}
                        />
                      </div>
                    )
                  )}
                </div>

                <div
                  className="mt-3 flex justify-between p-3 rounded-lg"
                  style={{ background: "#EFE8DE" }}
                >
                  <span>Total publicado</span>
                  <b>{totalVariantes} unidades</b>
                </div>
              </div>
            )}

            {variantType === "length_cm" && (
              <div className="mt-5">
                <div className="flex justify-between mb-2">
                  <span
                    className="text-sm font-medium"
                    style={{ color: "#7A0019" }}
                  >
                    Cantidad por largo
                  </span>

                  <span className="text-sm">
                    Total: <b>{totalVariantes}</b>
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[40, 45, 50, 55, 60, 65, 70].map((largo) => (
                    <div
                      key={largo}
                      className="w-28 p-2 rounded-lg text-center"
                      style={{
                        background: "#EFE8DE",
                        border: "1px solid #D8C9B5",
                      }}
                    >
                      <div className="text-xs mb-1">{largo} cm</div>

                      <input
                        type="number"
                        min={0}
                        value={variantStock[String(largo)] || 0}
                        onChange={(e) =>
                          cambiarCantidadVariante(
                            String(largo),
                            Number(e.target.value)
                          )
                        }
                        className="w-full text-center rounded-md py-1"
                        style={{
                          border: "1px solid #D8C9B5",
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div
                  className="mt-3 flex justify-between p-3 rounded-lg"
                  style={{ background: "#EFE8DE" }}
                >
                  <span>Total publicado</span>
                  <b>{totalVariantes} unidades</b>
                </div>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <input
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Descripción opcional: color, tamaño, detalle..."
                className="flex-1 px-3 py-2 rounded-lg"
                style={{ border: "1px solid #D8C9B5" }}
              />

              <button
                type="button"
                disabled={guardando}
                onClick={guardarCatalogo}
                className="px-4 py-2 rounded-lg flex items-center gap-2"
                style={{
                  background: "#A77D32",
                  color: "white",
                }}
              >
                <Save size={17} />
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        )}
      </div>
            <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2
            className="text-xl font-semibold"
            style={{ color: "#7A0019" }}
          >
            Productos publicados
          </h2>

          <span className="text-sm text-gray-500">
            {items.length} productos
          </span>
        </div>

        {items.length === 0 ? (
          <div
            className="rounded-xl p-8 text-center"
            style={{
              background: "#FAF7F2",
              border: "1px solid #E4D8C8",
            }}
          >
            No hay productos publicados en el catálogo.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {items.map((p) => {
              const productoInventario = productos.find(
                (producto) => producto.id === p.product_id
              );

              const stockInventario =
                Number(productoInventario?.stock_available) || 0;

              const totalPublicado =
                p.variant_type && p.variant_stock
                  ? Object.values(p.variant_stock).reduce(
                      (total, valor) => total + (Number(valor) || 0),
                      0
                    )
                  : Number(p.stock_available) || 0;

              return (
                <div
                  key={p.id}
                  className="rounded-xl p-4"
                  style={{
                    background: "#FAF7F2",
                    border: "1px solid #E4D8C8",
                  }}
                >
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="shrink-0">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="w-24 h-24 object-cover rounded-lg"
                        />
                      ) : (
                        <div
                          className="w-24 h-24 rounded-lg flex items-center justify-center text-xs text-center"
                          style={{
                            background: "#EFE8DE",
                            color: "#7A0019",
                          }}
                        >
                          Sin imagen
                        </div>
                      )}

                      {/* AHORA PERMITE CAMBIAR LA FOTO AUNQUE YA EXISTA */}
                      <label
                        className="inline-flex items-center gap-1 mt-2 text-xs px-2.5 py-1.5 rounded-md cursor-pointer"
                        style={{
                          background: "#EDE7DE",
                          border: "1px dashed #9C7A3C",
                          color: "#7A5F2D",
                        }}
                      >
                        <Upload size={13} />

                        {subiendoId === p.id
                          ? "Subiendo…"
                          : p.image_url
                          ? "Cambiar imagen"
                          : "Cargar imagen"}

                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={subiendoId === p.id}
                          onChange={(e) => {
                            const archivo = e.target.files?.[0];

                            if (archivo) {
                              subirImagenCatalogo(p.id, archivo);
                            }

                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-3">
                        <div>
                          <div
                            className="font-semibold text-lg"
                            style={{ color: "#7A0019" }}
                          >
                            {p.name}
                          </div>

                          <div className="text-sm">
                            Código: {p.code}
                          </div>

                          <div
                            className="font-semibold mt-1"
                            style={{ color: "#8A682C" }}
                          >
                            Bs {p.price}
                          </div>

                          <div className="text-sm mt-1">
                            Stock inventario: {stockInventario}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => eliminar(p.id)}
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            background: "#FBE7EA",
                            color: "#8A001C",
                          }}
                          title="Retirar del catálogo"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      {p.display_description && (
                        <div
                          className="mt-3 text-sm p-2 rounded-lg"
                          style={{
                            background: "#F5EFE7",
                            color: "#6D0017",
                          }}
                        >
                          {p.display_description}
                        </div>
                      )}

                      {p.variant_type === "ring_size" &&
                        p.variant_stock && (
                          <div className="mt-4">
                            <div
                              className="text-sm font-medium mb-2"
                              style={{ color: "#7A0019" }}
                            >
                              Cantidad por talla
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {Object.entries(p.variant_stock)
                                .sort(
                                  ([a], [b]) =>
                                    Number(a) - Number(b)
                                )
                                .map(([talla, unidades]) => (
                                  <div
                                    key={talla}
                                    className="px-3 py-2 rounded-lg text-sm"
                                    style={{
                                      background: "#EFE8DE",
                                      border:
                                        "1px solid #D8C9B5",
                                    }}
                                  >
                                    <div className="text-xs">
                                      Talla {talla}
                                    </div>

                                    <div
                                      className="font-semibold text-center"
                                      style={{
                                        color: "#7A0019",
                                      }}
                                    >
                                      {unidades}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                      {p.variant_type === "length_cm" &&
                        p.variant_stock && (
                          <div className="mt-4">
                            <div
                              className="text-sm font-medium mb-2"
                              style={{ color: "#7A0019" }}
                            >
                              Cantidad por largo
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {Object.entries(p.variant_stock)
                                .sort(
                                  ([a], [b]) =>
                                    Number(a) - Number(b)
                                )
                                .map(([largo, unidades]) => (
                                  <div
                                    key={largo}
                                    className="px-3 py-2 rounded-lg text-sm"
                                    style={{
                                      background: "#EFE8DE",
                                      border:
                                        "1px solid #D8C9B5",
                                    }}
                                  >
                                    <div className="text-xs">
                                      {largo} cm
                                    </div>

                                    <div
                                      className="font-semibold text-center"
                                      style={{
                                        color: "#7A0019",
                                      }}
                                    >
                                      {unidades}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                      <div
                        className="mt-4 flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg"
                        style={{
                          background: "#EFE8DE",
                        }}
                      >
                        <div>
                          <span className="text-sm">
                            Total publicado:{" "}
                          </span>

                          <strong style={{ color: "#7A0019" }}>
                            {totalPublicado} unidades
                          </strong>
                        </div>

                        <button
                          type="button"
                          onClick={() => abrirEdicion(p)}
                          className="px-4 py-2 rounded-lg text-sm font-medium"
                          style={{
                            background: "#A77D32",
                            color: "white",
                          }}
                        >
                          Editar publicación
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
