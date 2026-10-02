import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, Trash2, Search, ScanBarcode, UserPlus, ShoppingCart, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSellerSession } from "../hooks/useSellerSession";
import type { Customer, Product, Category } from "../lib/types";
import { precioNegocioPorCantidad } from "../lib/pricing";

interface LineaCarrito {
  product: Product;
  cantidad: number;
  precioPersonalizado?: number;
  ringSize?: string | null;
  stockTalla?: number | null;
}

// Pantalla inicial: escanear/buscar productos a una lista temporal (nada se
// descuenta todavía), y recién al presionar "Asignar cliente" (eligiendo un
// cliente existente, creando uno nuevo, o como venta directa sin cliente) se
// realiza la asignación real contra Supabase, de una sola vez.
export default function InicioVentas() {
  const navigate = useNavigate();
  const { vendedorActivoId, vendedorActivoNombre, sesionActivaId } = useSellerSession();
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [productoSinStock, setProductoSinStock] = useState<Product | null>(null);
  const [filaSeleccionada, setFilaSeleccionada] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaCarritoRef = useRef<HTMLDivElement>(null);
  const carritoRef = useRef<LineaCarrito[]>([]);
  const hidratadoRef = useRef(false);
  const productosCacheRef = useRef<Map<string, Product>>(new Map());
  const catalogoAnillosCacheRef = useRef<Map<string, any>>(new Map());
  const [mostrarAsignar, setMostrarAsignar] = useState(false);
  const [modo, setModo] = useState<"cliente" | "nuevo" | "directa">("cliente");
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [clienteElegido, setClienteElegido] = useState<Customer | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [procesando, setProcesando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Category[]>([]);

  useEffect(() => {
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => setClientes((data as Customer[]) ?? []));
    supabase.from("categories").select("*").order("sort_order").then(({ data }) => setCategorias((data as Category[]) ?? []));
  }, []);
useEffect(() => {
  let cancelado = false;

  async function restaurarCarritoActualizado() {
    const guardado = sessionStorage.getItem("inicioVentasPendiente");

    if (!guardado) {
      hidratadoRef.current = true;
      return;
    }

    try {
      const datos = JSON.parse(guardado);
      if (!Array.isArray(datos.carrito) || datos.carrito.length === 0) {
        hidratadoRef.current = true;
        return;
      }

      const carritoGuardado = datos.carrito as LineaCarrito[];
      const ids = Array.from(new Set(carritoGuardado.map((l) => l.product.id)));

      const { data: productosActuales, error: errorProductos } = await supabase
        .from("products")
        .select("*")
        .in("id", ids)
        .is("deleted_at", null);

      if (errorProductos) throw new Error(errorProductos.message);

      const { data: catalogoAnillos, error: errorCatalogo } = await supabase
        .from("catalog_products")
        .select("product_id, variant_type, variant_stock")
        .in("product_id", ids)
        .eq("active", true)
        .eq("variant_type", "ring_size");

      if (errorCatalogo) throw new Error(errorCatalogo.message);

      const productosPorId = new Map(
        ((productosActuales as Product[]) ?? []).map((p) => [p.id, p])
      );
      const anillosPorProducto = new Map(
        (catalogoAnillos ?? []).map((c: any) => [c.product_id, c])
      );

      const actualizado = carritoGuardado.flatMap((linea) => {
        const productoActual = productosPorId.get(linea.product.id);
        if (!productoActual) return [];

        productosCacheRef.current.set(productoActual.code, productoActual);

        let stockTalla = linea.stockTalla ?? null;
        if (linea.ringSize) {
          const catalogo = anillosPorProducto.get(productoActual.id) as any;
          stockTalla = Number(catalogo?.variant_stock?.[linea.ringSize] ?? 0);
          catalogoAnillosCacheRef.current.set(productoActual.id, catalogo ?? null);
        } else {
          catalogoAnillosCacheRef.current.delete(productoActual.id);
        }

        const limite = linea.ringSize
          ? Math.min(productoActual.stock_available, stockTalla ?? 0)
          : productoActual.stock_available;

        if (limite <= 0) return [];

        return [{
          ...linea,
          product: productoActual,
          stockTalla,
          cantidad: Math.min(linea.cantidad, limite),
        }];
      });

      if (!cancelado) {
        carritoRef.current = actualizado;
        hidratadoRef.current = true;
        setCarrito(actualizado);
      }
    } catch (error) {
      console.error("No se pudo actualizar la preasignación:", error);
      if (!cancelado) {
        try {
          const datos = JSON.parse(guardado);
          const carritoGuardado = Array.isArray(datos.carrito) ? datos.carrito : [];
          carritoRef.current = carritoGuardado;
          hidratadoRef.current = true;
          setCarrito(carritoGuardado);
        } catch {
          hidratadoRef.current = true;
        }
      }
    }
  }

  restaurarCarritoActualizado();
  return () => { cancelado = true; };
}, []);

useEffect(() => {
  carritoRef.current = carrito;
  if (!hidratadoRef.current) return;
  if (carrito.length > 0) {
    sessionStorage.setItem("inicioVentasPendiente", JSON.stringify({ carrito }));
  } else {
    sessionStorage.removeItem("inicioVentasPendiente");
  }
}, [carrito]);

  async function buscarYAgregar(e: React.FormEvent) {
    e.preventDefault();
    const codigoLeido = codigo.trim();
    if (!codigoLeido) return;

    setCodigo("");
    setNoEncontrado(false);
    setProductoSinStock(null);
    inputRef.current?.focus();

    try {
      let p = productosCacheRef.current.get(codigoLeido);

      // Si el producto normal ya fue leído una vez, las siguientes lecturas
      // suman inmediatamente sin esperar otra consulta a Supabase.
      if (p && catalogoAnillosCacheRef.current.has(p.id) &&
          catalogoAnillosCacheRef.current.get(p.id) === null) {
        const actual = carritoRef.current;
        const existente = actual.find((l) => l.product.id === p!.id && !l.ringSize);
        if (existente) {
          const siguiente = existente.cantidad >= p.stock_available
            ? actual
            : actual.map((l) =>
                l.product.id === p!.id && !l.ringSize
                  ? { ...l, cantidad: l.cantidad + 1 }
                  : l
              );
          carritoRef.current = siguiente;
          setCarrito(siguiente);
          setFilaSeleccionada(null);
          requestAnimationFrame(() => setFilaSeleccionada(p!.id));
          return;
        }
      }

      setBuscando(true);

      if (!p) {
        const { data: producto, error } = await supabase
          .from("products").select("*")
          .eq("code", codigoLeido)
          .is("deleted_at", null)
          .maybeSingle();

        if (error) throw new Error(error.message);
        if (!producto) {
          setNoEncontrado(true);
          return;
        }
        p = producto as Product;
        productosCacheRef.current.set(codigoLeido, p);
      }

      if (p.stock_available < 1) {
        setProductoSinStock(p);
        return;
      }

      let productoCatalogo: any;
      if (catalogoAnillosCacheRef.current.has(p.id)) {
        productoCatalogo = catalogoAnillosCacheRef.current.get(p.id);
      } else {
        const { data, error } = await supabase
          .from("catalog_products")
          .select("variant_type, variant_stock")
          .eq("product_id", p.id)
          .eq("active", true)
          .eq("variant_type", "ring_size")
          .maybeSingle();

        if (error) throw new Error(`No se pudo revisar las tallas: ${error.message}`);
        productoCatalogo = data ?? null;
        catalogoAnillosCacheRef.current.set(p.id, productoCatalogo);
      }

      if (productoCatalogo?.variant_type === "ring_size") {
        const tallas = (productoCatalogo.variant_stock ?? {}) as Record<string, number>;
        const disponibles = Object.entries(tallas)
          .filter(([, stock]) => Number(stock) > 0)
          .sort(([a], [b]) => Number(a) - Number(b));

        if (disponibles.length === 0) {
          alert("Este anillo no tiene tallas disponibles.");
          return;
        }

        const opciones = disponibles
          .map(([talla, stock]) => `Talla ${talla} — ${stock} disponibles`)
          .join("\n");
        const talla = window.prompt(
          `Selecciona la talla disponible:\n\n${opciones}\n\nEscribe solo el número de talla:`
        );
        if (talla === null) return;

        const tallaLimpia = talla.trim();
        const stockTalla = Number(tallas[tallaLimpia] ?? 0);
        if (stockTalla <= 0) {
          alert("La talla seleccionada no está disponible.");
          return;
        }

        const actual = carritoRef.current;
        const existente = actual.find(
          (l) => l.product.id === p!.id && l.ringSize === tallaLimpia
        );
        const siguiente = existente
          ? (existente.cantidad >= stockTalla ? actual : actual.map((l) =>
              l.product.id === p!.id && l.ringSize === tallaLimpia
                ? { ...l, cantidad: l.cantidad + 1 } : l))
          : [...actual, { product: p, cantidad: 1, ringSize: tallaLimpia, stockTalla }];

        carritoRef.current = siguiente;
        setCarrito(siguiente);
        const clave = `${p.id}-${tallaLimpia}`;
        setFilaSeleccionada(null);
        requestAnimationFrame(() => setFilaSeleccionada(clave));
        return;
      }

      const actual = carritoRef.current;
      const existente = actual.find((l) => l.product.id === p!.id && !l.ringSize);
      const siguiente = existente
        ? (existente.cantidad >= p.stock_available ? actual : actual.map((l) =>
            l.product.id === p!.id && !l.ringSize
              ? { ...l, cantidad: l.cantidad + 1 } : l))
        : [...actual, { product: p, cantidad: 1 }];

      carritoRef.current = siguiente;
      setCarrito(siguiente);
      setFilaSeleccionada(null);
      requestAnimationFrame(() => setFilaSeleccionada(p!.id));
    } catch (error: any) {
      alert(error?.message ?? "No se pudo agregar el producto.");
    } finally {
      setBuscando(false);
      inputRef.current?.focus();
    }
  }
  useEffect(() => {
  if (!filaSeleccionada || !listaCarritoRef.current) return;

  requestAnimationFrame(() => {
    const fila = listaCarritoRef.current?.querySelector(
      `#producto-carrito-${filaSeleccionada}`
    ) as HTMLElement | null;

    if (fila && listaCarritoRef.current) {
      const contenedor = listaCarritoRef.current;

      fila.scrollIntoView({
  behavior: "auto",
  block: "nearest",
});
    }
  });
}, [filaSeleccionada, carrito]);
    function cambiarCantidad(productId: string, delta: number, ringSize?: string | null) {
  setCarrito((prev) =>
    prev
      .map((l) => {
        const mismaLinea =
          l.product.id === productId &&
          (l.ringSize ?? null) === (ringSize ?? null);

        if (!mismaLinea) return l;

        const limite =
          l.ringSize && l.stockTalla != null
            ? Math.min(l.product.stock_available, l.stockTalla)
            : l.product.stock_available;

        return {
          ...l,
          cantidad: Math.max(0, Math.min(limite, l.cantidad + delta)),
        };
      })
      .filter((l) => l.cantidad > 0)
  );
}
 function quitarLinea(productId: string, ringSize?: string | null) {
  setCarrito((prev) =>
    prev.filter(
      (l) =>
        !(
          l.product.id === productId &&
          (l.ringSize ?? null) === (ringSize ?? null)
        )
    )
  );
  setFilaSeleccionada(null);
}
function cambiarPrecio(
  productId: string,
  valor: string,
  ringSize?: string | null
) {
  setCarrito((prev) =>
    prev.map((l) => {
      const mismaLinea =
        l.product.id === productId &&
        (l.ringSize ?? null) === (ringSize ?? null);

      if (!mismaLinea) return l;

      if (valor === "") {
        return { ...l, precioPersonalizado: undefined };
      }

      const precio = Number(valor);
      if (!Number.isFinite(precio) || precio < 0) return l;

      return { ...l, precioPersonalizado: precio };
    })
  );
}
        useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && filaSeleccionada) {
        const activo = document.activeElement;
        const enCampoDeTexto = activo && (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA" || activo.tagName === "SELECT");
        if (enCampoDeTexto) return;
        e.preventDefault();
        const linea = carrito.find(
  (l) =>
    (l.ringSize
      ? `${l.product.id}-${l.ringSize}`
      : l.product.id) === filaSeleccionada
);

if (linea) {
  quitarLinea(linea.product.id, linea.ringSize);
}
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filaSeleccionada, carrito]);

  useEffect(() => {
    function moverEntreItemsConFlechas(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (mostrarAsignar || carrito.length === 0) return;

      const activo = document.activeElement as HTMLElement | null;
      const tag = activo?.tagName;

      // Las flechas navegan por filas completas; nunca modifican precios ni otros campos.
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        activo?.isContentEditable
      ) {
        activo?.blur();
      }

      e.preventDefault();
      e.stopPropagation();

      const claves = carrito.map((l) =>
        l.ringSize ? `${l.product.id}-${l.ringSize}` : l.product.id
      );

      let indiceActual = filaSeleccionada ? claves.indexOf(filaSeleccionada) : -1;
      let indiceDestino: number;

      if (e.key === "ArrowDown") {
        indiceDestino = indiceActual < 0 ? 0 : Math.min(indiceActual + 1, claves.length - 1);
      } else {
        indiceDestino = indiceActual < 0 ? 0 : Math.max(indiceActual - 1, 0);
      }

      const claveDestino = claves[indiceDestino];
      setFilaSeleccionada(claveDestino);

      requestAnimationFrame(() => {
        const fila = document.getElementById(`producto-carrito-${claveDestino}`);
        fila?.scrollIntoView({ behavior: "auto", block: "nearest" });
      });
    }

    window.addEventListener("keydown", moverEntreItemsConFlechas, true);
    return () => window.removeEventListener("keydown", moverEntreItemsConFlechas, true);
  }, [mostrarAsignar, carrito, filaSeleccionada]);

  useEffect(() => {
    function volverAlBuscadorConEnter(e: KeyboardEvent) {
      if (e.key !== "Enter" || mostrarAsignar) return;
      const activo = document.activeElement as HTMLElement | null;
      if (activo === inputRef.current) return;
      if (activo?.tagName === "TEXTAREA" || activo?.tagName === "SELECT") return;
      e.preventDefault();
      e.stopPropagation();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", volverAlBuscadorConEnter);
    return () => window.removeEventListener("keydown", volverAlBuscadorConEnter);
  }, [mostrarAsignar]);

  useEffect(() => {
    function confirmarConEnter(e: KeyboardEvent) {
      if (e.key !== "Enter" || !mostrarAsignar || procesando || carrito.length === 0) return;
      const el = e.target as HTMLElement | null;
      // Los campos del formulario conservan Enter para confirmar, pero evitamos
      // interferir con botones/selects y con el buscador mientras aún no hay cliente elegido.
      if (el?.tagName === "BUTTON" || el?.tagName === "SELECT" || el?.tagName === "TEXTAREA") return;
      if (modo === "cliente" && !clienteElegido) return;
      if (modo === "nuevo" && (!nuevoNombre.trim() || !nuevoTelefono.trim())) return;
      e.preventDefault();
      confirmarAsignacion();
    }
    window.addEventListener("keydown", confirmarConEnter);
    return () => window.removeEventListener("keydown", confirmarConEnter);
  }, [mostrarAsignar, procesando, carrito, modo, clienteElegido, nuevoNombre, nuevoTelefono]);

 function precioPreview(l: LineaCarrito) {
  if (l.precioPersonalizado !== undefined) {
    return l.precioPersonalizado;
  }

  const categoria =
    categorias.find((c) => c.id === l.product.category_id)?.name ?? null;

  return precioNegocioPorCantidad(
    categoria,
    l.product.name,
    l.cantidad,
    Number(l.product.price),
    l.product.description
  );
}
  const total = carrito.reduce((a, l) => a + precioPreview(l) * l.cantidad, 0);
  const unidades = carrito.reduce((a, l) => a + l.cantidad, 0);

  const coincidenciasCliente = useMemo(() => {
    const q = busquedaCliente.trim().toLowerCase();
    if (!q) return clientes.slice(0, 8);
    return clientes.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 8);
  }, [busquedaCliente, clientes]);

  async function obtenerOrdenAbierta(customerId: string) {
    const { data: existente } = await supabase
      .from("orders").select("id").eq("customer_id", customerId).in("status", ["open", "reopened"]).maybeSingle();
    if (existente) return existente.id as string;
    const { data: nueva } = await supabase.from("orders").insert({ customer_id: customerId }).select().single();
    return nueva!.id as string;
  }

  // Único momento en que se escribe de verdad en Supabase (con protección
  // contra doble ejecución vía "procesando").
  async function confirmarAsignacion(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (procesando || carrito.length === 0) return;

    if (modo === "cliente" && !clienteElegido) { alert("Elige un cliente de la lista."); return; }
    if (modo === "nuevo" && (!nuevoNombre.trim() || !nuevoTelefono.trim())) { alert("Completa nombre y teléfono del cliente nuevo."); return; }

    setProcesando(true);
    try {
      // Validar stock de TODAS las líneas antes de escribir nada, para no
      // dejar una asignación a medias si algo cambió justo antes de confirmar.
      const ids = carrito.map((l) => l.product.id);
      const { data: stockActual, error: errStock } = await supabase.from("products").select("id, code, stock_available").in("id", ids);
      if (errStock) throw new Error(errStock.message);
      for (const l of carrito) {
        const actual = stockActual?.find((p: any) => p.id === l.product.id);
        if (!actual || actual.stock_available < l.cantidad) {
          throw new Error(`Ya no hay stock suficiente de ${l.product.code} (disponible: ${actual?.stock_available ?? 0}, pedido: ${l.cantidad}). No se asignó nada.`);
        }
      }

      let customerId: string | null = null;
      let nombreDestino = "Venta directa";

      if (modo === "cliente" && clienteElegido) {
        customerId = clienteElegido.id;
        nombreDestino = clienteElegido.name;
      } else if (modo === "nuevo") {
        const { data: creado, error } = await supabase.from("customers").insert({ name: nuevoNombre.trim(), phone: nuevoTelefono.trim() }).select().single();
        if (error || !creado) throw new Error(error?.message ?? "No se pudo crear el cliente");
        customerId = creado.id;
        nombreDestino = creado.name;
      }

      if (modo === "directa") {
        const { data: orden, error } = await supabase.from("orders").insert({ customer_id: null, direct_sale: true }).select().single();
        if (error || !orden) throw new Error(error?.message ?? "No se pudo iniciar la venta directa");
        for (const l of carrito) {
          const { error: errAsig } = await supabase.rpc("assign_product_to_order", {
            p_order_id: orden.id, p_product_id: l.product.id, p_quantity: l.cantidad, p_origin: "manual",
            p_seller_id: vendedorActivoId,
p_session_id: sesionActivaId,
p_unit_price: precioPreview(l),
            p_ring_size: l.ringSize ?? null,
          });
          if (errAsig) throw new Error(errAsig.message);
        }
        const { data: totalReal, error: errCalc } = await supabase.rpc("calcular_total_pedido", { p_order_id: orden.id });
        if (errCalc) throw new Error(errCalc.message);
        if ((totalReal ?? 0) > 0) {
          await supabase.from("payments").insert({ customer_id: null, order_id: orden.id, amount: totalReal, method: metodoPago });
        }
        const { error: errCierre } = await supabase.rpc("close_order", { p_order_id: orden.id });
        if (errCierre) throw new Error(errCierre.message);
        setUltimoResultado(`Venta directa finalizada — Total Bs ${(totalReal ?? 0).toFixed(2)}`);
      } else if (customerId) {
        const orderId = await obtenerOrdenAbierta(customerId);
        for (const l of carrito) {
          const { error: errAsig } = await supabase.rpc("assign_product_to_order", {
            p_order_id: orderId, p_product_id: l.product.id, p_quantity: l.cantidad, p_origin: "manual",
            p_seller_id: vendedorActivoId,
p_session_id: sesionActivaId,
p_unit_price: precioPreview(l),
            p_ring_size: l.ringSize ?? null,
          });
          if (errAsig) throw new Error(errAsig.message);
        }
        setUltimoResultado(`Asignado a ${nombreDestino}: ${unidades} unidad(es) — Bs ${total.toFixed(2)}. El pedido sigue abierto hasta que se cierre desde Clientes.`);
      }

      // La asignación ya terminó correctamente: recién aquí limpiamos
      // por completo la lista temporal y su respaldo de sesión.
      carritoRef.current = [];
      setCarrito([]);
      sessionStorage.removeItem("inicioVentasPendiente");
      productosCacheRef.current.clear();
      catalogoAnillosCacheRef.current.clear();
      setFilaSeleccionada(null);
      setCodigo("");
      setProductoSinStock(null);
      setNoEncontrado(false);
      setMostrarAsignar(false);
      setClienteElegido(null);
      setBusquedaCliente("");
      setNuevoNombre("");
      setNuevoTelefono("");
      setModo("cliente");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="font-serif text-lg flex items-center gap-2"><ShoppingCart size={18} /> Asignación rápida / Venta directa</p>
          <span className="text-xs" style={{ color: "#5B4E5E" }}>
            {vendedorActivoNombre ? `Vendedor: ${vendedorActivoNombre}` : "Sin vendedor activo"}
          </span>
        </div>

        {ultimoResultado && (
          <div className="p-3 mb-3 rounded-md" style={{ background: "#E4EBE1", border: "1px solid #4F6F52" }}>
            <p className="text-xs" style={{ color: "#4F6F52" }}>{ultimoResultado}</p>
          </div>
        )}

        <form onSubmit={buscarYAgregar} className="p-4 rounded-md mb-3 ls-code-search">
          <p className="text-xs mb-2 flex items-center gap-1.5" className="ls-code-search-label"><ScanBarcode size={14} /> Escanear o escribir código — Enter agrega a la lista</p>
          <div className="flex gap-2">
            <input ref={inputRef} autoFocus value={codigo} onChange={(e) => { setCodigo(e.target.value); setNoEncontrado(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="80-50"
              className="flex-1 px-3 py-3 rounded text-lg outline-none" style={{ background: "#F7F3EC", color: "#2B1E2E" }} />
            <button type="submit" aria-busy={buscando} className="px-5 rounded flex items-center gap-1.5 ls-code-search-button">
              <Plus size={16} /> Agregar
            </button>
          </div>
          {noEncontrado && (
            <div className="mt-3 p-3 rounded" style={{ background: "#F4E3E6" }}>
              <p className="text-xs" style={{ color: "#7A2540" }}>No se encontró ningún producto con ese código.</p>
            </div>
          )}
          {productoSinStock && (
  <div className="mt-3 p-3 rounded" style={{ background: "#F4E3E6" }}>
    <p className="text-xs mb-2" style={{ color: "#7A2540" }}>
      Este producto está agotado.
    </p>

    <button
      type="button"
      onClick={() => {
        sessionStorage.setItem(
          "inicioVentasPendiente",
          JSON.stringify({
            carrito,
            codigo: productoSinStock.code,
          })
        );

        navigate(
          `/productos?desde=asignar&codigo=${encodeURIComponent(productoSinStock.code)}`
        );
      }}
      className="px-3 py-2 rounded text-xs font-medium"
      style={{ background: "#9C7A3C", color: "#F7F3EC" }}
    >
      Editar stock en Productos
    </button>
  </div>
)}
        </form>

        <div ref={listaCarritoRef}
  style={{
    background: "#F7F3EC",
    border: "1px solid #D9D0C2",
    maxHeight: "calc(100vh - 330px)",
    overflowY: "auto",
    scrollBehavior: "auto",
  }}
>
          {carrito.length === 0 && <p className="text-sm p-4" style={{ color: "#5B4E5E" }}>Escanea o escribe un código para empezar. Selecciona una fila y presiona Supr para quitarla.</p>}
          {carrito.map((l, i) => (
            <div
 key={`${l.product.id}-${l.ringSize ?? "normal"}`}
id={`producto-carrito-${l.ringSize ? `${l.product.id}-${l.ringSize}` : l.product.id}`}
onClick={() =>
  setFilaSeleccionada(
    l.ringSize ? `${l.product.id}-${l.ringSize}` : l.product.id
  )
}
              className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer"
style={{
  borderBottom: i < carrito.length - 1 ? "1px solid #D9D0C2" : "none",
  background:
    filaSeleccionada ===
    (l.ringSize ? `${l.product.id}-${l.ringSize}` : l.product.id)
      ? "#EDE7DE"
      : "transparent",
}}>
                    <div>
                <p className="text-sm">
  {l.product.code} · {l.product.name}
  {l.ringSize ? ` · Talla ${l.ringSize}` : ""} × {l.cantidad}
</p>
<div className="flex items-center gap-2 mt-1">
  <span className="text-xs" style={{ color: "#5B4E5E" }}>
    Precio Bs
  </span>
  <input
    type="number"
    min="0"
    step="1"
    value={l.precioPersonalizado ?? precioPreview(l)}
    onClick={(e) => e.stopPropagation()}
    onChange={(e) =>
  cambiarPrecio(l.product.id, e.target.value, l.ringSize)
}
    onKeyDown={(e) => {
      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
      }
    }}
    className="w-20 px-2 py-1 rounded text-xs outline-none"
    style={{
      background: "#FFFFFF",
      border: "1px solid #D9D0C2",
      color: "#2B1E2E",
    }}
  />
  <span className="text-xs" style={{ color: "#5B4E5E" }}>
    c/u · {l.product.stock_available} disponibles
  </span>
</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-serif text-sm">Bs {(precioPreview(l) * l.cantidad).toFixed(2)}</span>
                <button
  onClick={(e) => {
    e.stopPropagation();
    cambiarCantidad(l.product.id, -1, l.ringSize);
  }}
  className="w-7 h-7 rounded-full flex items-center justify-center"
  style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}
>
  <Minus size={13} />
</button>

<button
  onClick={(e) => {
    e.stopPropagation();
    cambiarCantidad(l.product.id, 1, l.ringSize);
  }}
  disabled={
    l.cantidad >=
    (l.ringSize && l.stockTalla != null
      ? Math.min(l.product.stock_available, l.stockTalla)
      : l.product.stock_available)
  }
  className="w-7 h-7 rounded-full flex items-center justify-center"
  style={{ background: "#9C7A3C", color: "#F7F3EC" }}
>
  <Plus size={13} />
</button>
                <button onClick={(e) => { e.stopPropagation(); quitarLinea(l.product.id, l.ringSize); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#F4E3E6", color: "#7A2540" }} title="Quitar (Supr)">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Resumen</p>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: "#5B4E5E" }}>Unidades</span><span>{unidades}</span></div>
        <div className="flex justify-between text-sm mb-3 pt-1.5" style={{ borderTop: "1px solid #D9D0C2" }}><span style={{ color: "#5B4E5E" }}>Total</span><span className="font-serif">Bs {total.toFixed(2)}</span></div>
        <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>El descuento por cantidad acumulada se calcula al asignarlo al pedido del cliente (o al cerrar la venta directa).</p>

        {!mostrarAsignar ? (
          <button onClick={() => setMostrarAsignar(true)} disabled={carrito.length === 0} className="w-full py-2.5 rounded-md text-sm flex items-center justify-center gap-2"
            style={{ background: carrito.length > 0 ? "#2B1E2E" : "#D9D0C2", color: "#F7F3EC" }}>
            <Users size={15} /> Asignar cliente
          </button>
        ) : (
          <form onSubmit={confirmarAsignacion} className="p-3 rounded-md" style={{ background: "#EDE7DE" }}>
            <div className="flex gap-1.5 mb-2">
              <button type="button" onClick={() => setModo("cliente")} className="flex-1 text-xs px-2 py-1.5 rounded-md" style={{ background: modo === "cliente" ? "#9C7A3C" : "#F7F3EC", color: modo === "cliente" ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>Cliente</button>
              <button type="button" onClick={() => setModo("nuevo")} className="flex-1 text-xs px-2 py-1.5 rounded-md" style={{ background: modo === "nuevo" ? "#9C7A3C" : "#F7F3EC", color: modo === "nuevo" ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>Nuevo</button>
              <button type="button" onClick={() => setModo("directa")} className="flex-1 text-xs px-2 py-1.5 rounded-md" style={{ background: modo === "directa" ? "#9C7A3C" : "#F7F3EC", color: modo === "directa" ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>Directa</button>
            </div>

            {modo === "cliente" && (
              <div className="mb-2">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded mb-1" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                  <Search size={13} style={{ color: "#5B4E5E" }} />
                  <input value={clienteElegido ? clienteElegido.name : busquedaCliente} onChange={(e) => { setBusquedaCliente(e.target.value); setClienteElegido(null); }}
                    placeholder="Buscar cliente…" className="flex-1 text-sm outline-none bg-transparent" />
                </div>
                {!clienteElegido && (
                  <div className="max-h-32 overflow-y-auto rounded" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                    {coincidenciasCliente.map((c) => (
                      <button key={c.id} type="button" onClick={() => setClienteElegido(c)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-black/5" style={{ borderBottom: "1px solid #D9D0C2" }}>
                        {c.name} <span style={{ color: "#5B4E5E" }}>({c.phone})</span>
                      </button>
                    ))}
                    {coincidenciasCliente.length === 0 && <p className="text-xs p-2" style={{ color: "#5B4E5E" }}>Sin resultados.</p>}
                  </div>
                )}
              </div>
            )}

            {modo === "nuevo" && (
              <div className="mb-2 flex flex-col gap-1.5">
                <p className="text-xs flex items-center gap-1" style={{ color: "#5B4E5E" }}><UserPlus size={12} /> Cliente nuevo</p>
                <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nombre" className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
                <input value={nuevoTelefono} onChange={(e) => setNuevoTelefono(e.target.value)} placeholder="Teléfono / WhatsApp" className="px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }} />
              </div>
            )}

            {modo === "directa" && (
              <div className="mb-2">
                <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Método de pago (venta directa, se cierra de inmediato)</p>
                <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full px-2 py-1.5 rounded text-sm outline-none" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="qr">QR</option>
                </select>
              </div>
            )}

            <div className="flex gap-2">
              <button type="submit" disabled={procesando} className="flex-1 text-xs py-2 rounded-md" style={{ background: "#2B1E2E", color: "#F7F3EC" }}>
                {procesando ? "Procesando..." : "Confirmar (Enter)"}
              </button>
              <button type="button" onClick={() => setMostrarAsignar(false)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
