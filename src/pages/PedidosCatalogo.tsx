import React, { useEffect, useRef, useState } from "react";
import { Check, X, Clock, Search, FileText, FolderOpen } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { CatalogSubmission, Customer } from "../lib/types";
import { generarPdfCatalogo } from "../lib/pdf";

interface ItemPedido {
  id: string;
  catalog_product_id: string;
  code: string;
  name: string;
  image_url: string | null;
  price: number;
  cantidadOriginal: number;
  cantidadAAsignar: number;
  variant_key: string | null;
  variant_type: "ring_size" | "length_cm" | null;
}

interface PedidoConItems extends CatalogSubmission {
  items: ItemPedido[];
}

export default function PedidosCatalogo() {
  const [pedidos, setPedidos] = useState<PedidoConItems[]>([]);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [clienteManual, setClienteManual] = useState<Record<string, string>>({});
  const [busquedaCliente, setBusquedaCliente] = useState<Record<string, string>>({});
  const [pedidoAbierto, setPedidoAbierto] = useState<string | null>(null);
  const [pedidoArchivoAbierto, setPedidoArchivoAbierto] = useState<string | null>(null);

  const hoyLocal = new Date();
  const fechaHoy = `${hoyLocal.getFullYear()}-${String(
    hoyLocal.getMonth() + 1
  ).padStart(2, "0")}-${String(hoyLocal.getDate()).padStart(2, "0")}`;

  const [fechaDesde, setFechaDesde] = useState(fechaHoy);
  const [fechaHasta, setFechaHasta] = useState(fechaHoy);
  const [imagenAmpliada, setImagenAmpliada] = useState<string | null>(null);
  const imagenAmpliadaRef = useRef<string | null>(null);

  useEffect(() => {
    cargar();

    supabase
      .from("customers")
      .select("*")
      .is("deleted_at", null)
      .order("name")
      .then(({ data }) => setClientes((data as Customer[]) ?? []));
  }, []);

  useEffect(() => {
    imagenAmpliadaRef.current = imagenAmpliada;
  }, [imagenAmpliada]);

  useEffect(() => {
    function cerrarConEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && imagenAmpliadaRef.current) {
        setImagenAmpliada(null);
        imagenAmpliadaRef.current = null;
      }
    }

    function manejarAtras() {
      if (!imagenAmpliadaRef.current) return;

      setImagenAmpliada(null);
      imagenAmpliadaRef.current = null;
    }

    window.addEventListener("keydown", cerrarConEscape);
    window.addEventListener("popstate", manejarAtras);

    return () => {
      window.removeEventListener("keydown", cerrarConEscape);
      window.removeEventListener("popstate", manejarAtras);
    };
  }, []);

  async function cargar() {
    const { data } = await supabase
      .from("catalog_submissions")
      .select(
        "*, catalog_submission_items(id, catalog_product_id, quantity, variant_key, catalog_products(code, name, variant_type, image_url, price))"
      )
      .order("created_at", { ascending: false });

    const lista: PedidoConItems[] = (data ?? []).map((s: any) => ({
      ...s,
      items: (s.catalog_submission_items ?? []).map((it: any) => ({
        id: it.id,
        catalog_product_id: it.catalog_product_id,
        code: it.catalog_products?.code ?? "",
        name: it.catalog_products?.name ?? "",
        image_url: it.catalog_products?.image_url ?? null,
        price: Number(it.catalog_products?.price ?? 0),
        cantidadOriginal: it.quantity,
        cantidadAAsignar: it.quantity,
        variant_key: it.variant_key ?? null,
        variant_type: it.catalog_products?.variant_type ?? null,
      })),
    }));

    setPedidos(lista);
  }

  function cambiarCantidad(
    pedidoId: string,
    itemId: string,
    cantidad: number
  ) {
    setPedidos((prev) =>
      prev.map((p) =>
        p.id !== pedidoId
          ? p
          : {
              ...p,
              items: p.items.map((it) =>
                it.id === itemId
                  ? {
                      ...it,
                      cantidadAAsignar: Math.max(0, cantidad),
                    }
                  : it
              ),
            }
      )
    );
  }

  function normalizarTelefono(v: string) {
    return (v ?? "").replace(/\D/g, "").replace(/^591/, "");
  }

  function clienteAutomatico(pedido: PedidoConItems) {
    const tel = normalizarTelefono(pedido.customer_phone);

    return (
      clientes.find(
        (c) => normalizarTelefono(c.phone) === tel
      ) ?? null
    );
  }

  async function aceptar(pedido: PedidoConItems) {
    setProcesando(pedido.id);

    try {
      let cliente: { id: string } | null = null;
      const manualId = clienteManual[pedido.id];

      if (manualId) {
        cliente = { id: manualId };
      }

      if (!cliente) {
        const existente = clienteAutomatico(pedido);

        if (existente) {
          cliente = { id: existente.id };
        }
      }

      if (!cliente) {
        const { data: nuevo, error: errNuevo } = await supabase
          .from("customers")
          .insert({
            name: pedido.customer_name,
            phone: pedido.customer_phone,
          })
          .select("id")
          .single();

        if (errNuevo) {
          throw new Error(errNuevo.message);
        }

        cliente = nuevo;
      }

      if (!cliente) {
        throw new Error("No se pudo determinar el cliente.");
      }

      const items = pedido.items.map((it) => ({
        catalog_product_id: it.catalog_product_id,
        quantity: it.cantidadAAsignar,
        variant_key: it.variant_key,
      }));

      const { error } = await supabase.rpc(
        "accept_catalog_submission",
        {
          p_submission_id: pedido.id,
          p_customer_id: cliente.id,
          p_items: items,
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      await cargar();
    } catch (err: any) {
      alert(`No se pudo aceptar el pedido: ${err.message}`);
    } finally {
      setProcesando(null);
    }
  }

  async function rechazar(pedido: PedidoConItems) {
    if (
      !confirm(
        `¿Rechazar el pedido ${pedido.code}? Las unidades reservadas vuelven a estar disponibles.`
      )
    ) {
      return;
    }

    setProcesando(pedido.id);

    await supabase.rpc("discard_catalog_submission", {
      p_submission_id: pedido.id,
    });

    setProcesando(null);
    cargar();
  }

  async function abrirPdfPedido(pedido: PedidoConItems) {
    const items = pedido.items.map((it) => ({
      codigo: it.code,
      nombre: it.name,
      imagen: it.image_url,
      cantidad: it.cantidadOriginal,
      precio: it.price,
      variante: it.variant_key
        ? it.variant_type === "ring_size"
          ? `Talla ${it.variant_key}`
          : `${it.variant_key} cm`
        : null,
    }));

    const totalUnidades = items.reduce(
      (t, it) => t + it.cantidad,
      0
    );

    const total = items.reduce(
      (t, it) => t + it.precio * it.cantidad,
      0
    );

    await generarPdfCatalogo({
      negocio: "Love's Stories",
      codigoPedido: pedido.code,
      cliente: pedido.customer_name,
      telefono: pedido.customer_phone,
      fecha: new Date(pedido.created_at).toLocaleString("es-BO"),
      items,
      totalUnidades,
      total,
    });
  }

  const pedidosPendientes = pedidos.filter(
    (p: any) => p.status === "pending"
  );

  const pedidosRechazados = pedidos.filter((p: any) =>
    ["discarded", "rejected", "cancelled"].includes(
      String(p.status ?? "").toLowerCase()
    )
  );

  const pedidosArchivados = pedidos.filter(
    (p: any) =>
      p.status !== "pending" &&
      !["discarded", "rejected", "cancelled"].includes(
        String(p.status ?? "").toLowerCase()
      )
  );

  const agruparPorFecha = (lista: PedidoConItems[]) =>
    lista.reduce<Record<string, PedidoConItems[]>>(
      (acc, pedido) => {
        const fecha = new Date(
          pedido.created_at
        ).toLocaleDateString("es-BO");

        (acc[fecha] ??= []).push(pedido);

        return acc;
      },
      {}
    );

  function agruparItemsVisual(items: ItemPedido[]) {
    const grupos = new Map<
      string,
      {
        key: string;
        code: string;
        name: string;
        image_url: string | null;
        price: number;
        cantidadTotal: number;
        subtotal: number;
        variantes: { texto: string; cantidad: number }[];
      }
    >();

    items.forEach((it) => {
      const clave = it.catalog_product_id || it.code;
      let grupo = grupos.get(clave);

      if (!grupo) {
        grupo = {
          key: clave,
          code: it.code,
          name: it.name,
          image_url: it.image_url,
          price: it.price,
          cantidadTotal: 0,
          subtotal: 0,
          variantes: [],
        };
        grupos.set(clave, grupo);
      }

      grupo.cantidadTotal += it.cantidadOriginal;
      grupo.subtotal += it.price * it.cantidadOriginal;

      if (it.variant_key) {
        const texto =
          it.variant_type === "ring_size"
            ? `Talla ${it.variant_key}`
            : `${it.variant_key} cm`;

        const existente = grupo.variantes.find((v) => v.texto === texto);
        if (existente) {
          existente.cantidad += it.cantidadOriginal;
        } else {
          grupo.variantes.push({
            texto,
            cantidad: it.cantidadOriginal,
          });
        }
      }
    });

    return Array.from(grupos.values());
  }

  function estaEnRango(pedido: PedidoConItems) {
    const fecha = new Date(pedido.created_at);

    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, "0");
    const d = String(fecha.getDate()).padStart(2, "0");

    const clave = `${y}-${m}-${d}`;

    return clave >= fechaDesde && clave <= fechaHasta;
  }

  const pedidosArchivadosFiltrados =
    pedidosArchivados.filter(estaEnRango);

  const pedidosRechazadosFiltrados =
    pedidosRechazados.filter(estaEnRango);

  const archivadosPorFecha = agruparPorFecha(
    pedidosArchivadosFiltrados
  );

  const rechazadosPorFecha = agruparPorFecha(
    pedidosRechazadosFiltrados
  );

  return (
    <div>
      <p className="font-serif text-lg mb-1">
        Pedidos del catálogo
      </p>

      <p
        className="text-xs mb-3"
        style={{ color: "#5B4E5E" }}
      >
        Pedidos que tus clientes enviaron desde el link público.
        Al aceptar, se asignan al cliente en su pedido abierto.
        Si falta o está defectuosa alguna unidad, baja la cantidad
        antes de aceptar.
      </p>

      <div className="flex flex-col gap-3">
        {pedidosPendientes.map((p) => {
          const abierto = pedidoAbierto === p.id;

          const totalPedido = p.items.reduce(
            (total, it) =>
              total + it.price * it.cantidadAAsignar,
            0
          );

          const fechaPedido = new Date(p.created_at);

          return (
            <div
              key={p.id}
              className="rounded-md overflow-hidden"
              style={{
                background: "#F7F3EC",
                border: "1px solid #D9D0C2",
              }}
            >
              {/* RESUMEN DEL PEDIDO */}
              <div className="p-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Pedido {p.code}
                    </p>

                    <p className="text-sm mt-1">
                      {p.customer_name}
                    </p>

                    <p
                      className="text-xs mt-1"
                      style={{ color: "#5B4E5E" }}
                    >
                      {p.customer_phone}
                    </p>

                    <div
                      className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-1"
                      style={{ color: "#5B4E5E" }}
                    >
                      <span>
                        Fecha:{" "}
                        {fechaPedido.toLocaleDateString(
                          "es-BO"
                        )}
                      </span>

                      <span>
                        <Clock
                          size={11}
                          className="inline -mt-0.5 mr-1"
                        />

                        {fechaPedido.toLocaleTimeString(
                          "es-BO",
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setPedidoAbierto(
                        abierto ? null : p.id
                      )
                    }
                    className="px-4 py-2 rounded-md text-xs font-medium shrink-0"
                    style={{
                      background: abierto
                        ? "#EDE7DE"
                        : "#9C7A3C",
                      color: abierto
                        ? "#5B4E5E"
                        : "#F7F3EC",
                      border: "1px solid #D9D0C2",
                    }}
                  >
                    {abierto
                      ? "Cerrar detalle"
                      : "Ver detalle"}
                  </button>
                </div>
              </div>

              {/* DETALLE DEL PEDIDO */}
              {abierto && (
                <div
                  className="p-3"
                  style={{
                    borderTop: "1px solid #D9D0C2",
                  }}
                >
                  <p
                    className="text-xs font-medium mb-2"
                    style={{ color: "#5B4E5E" }}
                  >
                    PRODUCTOS DEL PEDIDO
                  </p>

                  <div className="flex flex-col gap-2">
                    {p.items.map((it) => (
                      <div
                        key={it.id}
                        className="p-2 rounded-md"
                        style={{
                          background: "#EDE7DE",
                          border: "1px solid #D9D0C2",
                        }}
                      >
                        <div className="flex gap-3">
                          {/* FOTO */}
                          <div className="shrink-0">
                            {it.image_url ? (
                              <img
                                src={it.image_url}
                                alt={it.name}
                                onClick={() => {
                                  setImagenAmpliada(
                                    it.image_url
                                  );

                                  imagenAmpliadaRef.current =
                                    it.image_url;

                                  window.history.pushState(
                                    {
                                      fotoPedido: true,
                                    },
                                    ""
                                  );
                                }}
                                className="w-20 h-20 rounded-md object-cover cursor-zoom-in"
                                style={{
                                  border:
                                    "1px solid #D9D0C2",
                                }}
                              />
                            ) : (
                              <div
                                className="w-20 h-20 rounded-md flex items-center justify-center text-xs"
                                style={{
                                  background: "#F7F3EC",
                                  border:
                                    "1px solid #D9D0C2",
                                  color: "#5B4E5E",
                                }}
                              >
                                Sin foto
                              </div>
                            )}
                          </div>

                          {/* DATOS */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">
                              {it.code}
                            </p>

                            <p className="text-xs mt-1">
                              {it.name}
                            </p>

                            {it.variant_key && (
                              <p
                                className="text-xs mt-1"
                                style={{
                                  color: "#7A5F2D",
                                }}
                              >
                                {it.variant_type ===
                                "ring_size"
                                  ? `Talla ${it.variant_key}`
                                  : `${it.variant_key} cm`}
                              </p>
                            )}

                            <p
                              className="text-xs mt-1"
                              style={{
                                color: "#5B4E5E",
                              }}
                            >
                              Precio: Bs {it.price}
                            </p>

                            <p className="text-xs mt-1 font-medium">
                              Subtotal: Bs{" "}
                              {it.price *
                                it.cantidadAAsignar}
                            </p>
                          </div>
                        </div>

                        {/* CANTIDAD */}
                        <div
                          className="flex items-center justify-between mt-2 pt-2"
                          style={{
                            borderTop:
                              "1px solid #D9D0C2",
                          }}
                        >
                          <span
                            className="text-xs"
                            style={{
                              color: "#5B4E5E",
                            }}
                          >
                            Cantidad a asignar
                          </span>

                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={
                                it.cantidadOriginal
                              }
                              value={
                                it.cantidadAAsignar
                              }
                              onChange={(e) =>
                                cambiarCantidad(
                                  p.id,
                                  it.id,
                                  Number(
                                    e.target.value
                                  )
                                )
                              }
                              className="w-16 px-2 py-1.5 rounded text-sm text-center outline-none"
                              style={{
                                background:
                                  "#F7F3EC",
                                border:
                                  "1px solid #D9D0C2",
                              }}
                            />

                            <span
                              className="text-xs"
                              style={{
                                color: "#5B4E5E",
                              }}
                            >
                              / {it.cantidadOriginal}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* TOTAL */}
                  <div
                    className="flex justify-between items-center mt-3 p-3 rounded-md"
                    style={{
                      background: "#FFF",
                      border: "1px solid #D9D0C2",
                    }}
                  >
                    <span className="text-sm font-medium">
                      TOTAL DEL PEDIDO
                    </span>

                    <span
                      className="text-lg font-medium"
                      style={{ color: "#7A5F2D" }}
                    >
                      Bs {totalPedido}
                    </span>
                  </div>
                                    {/* ASIGNACIÓN DEL CLIENTE */}
                  <div
                    className="mt-3 p-3 rounded"
                    style={{
                      background: "#EDE7DE",
                      border: "1px solid #D9D0C2",
                    }}
                  >
                    {clienteAutomatico(p) &&
                      !clienteManual[p.id] && (
                        <p
                          className="text-xs mb-2"
                          style={{ color: "#4F6F52" }}
                        >
                          Teléfono reconocido: se asignará a{" "}
                          {clienteAutomatico(p)!.name} (
                          {clienteAutomatico(p)!.phone}).
                        </p>
                      )}

                    <p
                      className="text-xs mb-1"
                      style={{ color: "#5B4E5E" }}
                    >
                      O asignar manualmente a otro cliente:
                    </p>

                    <div className="relative">
                      <Search
                        size={13}
                        className="absolute left-2 top-2.5"
                      />

                      <input
                        value={busquedaCliente[p.id] ?? ""}
                        onChange={(e) =>
                          setBusquedaCliente((x) => ({
                            ...x,
                            [p.id]: e.target.value,
                          }))
                        }
                        placeholder="Buscar nombre o teléfono"
                        className="w-full pl-7 pr-2 py-2 rounded text-xs outline-none"
                        style={{
                          background: "#F7F3EC",
                          border: "1px solid #D9D0C2",
                        }}
                      />
                    </div>

                    {(busquedaCliente[p.id] ?? "").trim() && (
                      <div
                        className="max-h-28 overflow-y-auto mt-1 rounded"
                        style={{
                          background: "#F7F3EC",
                          border: "1px solid #D9D0C2",
                        }}
                      >
                        {clientes
                          .filter((c) => {
                            const q = (
                              busquedaCliente[p.id] ?? ""
                            ).toLowerCase();

                            return (
                              c.name
                                .toLowerCase()
                                .includes(q) ||
                              c.phone.includes(q)
                            );
                          })
                          .slice(0, 6)
                          .map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setClienteManual((x) => ({
                                  ...x,
                                  [p.id]: c.id,
                                }));

                                setBusquedaCliente((x) => ({
                                  ...x,
                                  [p.id]: `${c.name} (${c.phone})`,
                                }));
                              }}
                              className="block w-full text-left px-2 py-1.5 text-xs"
                            >
                              {c.name} ({c.phone})
                            </button>
                          ))}
                      </div>
                    )}

                    {clienteManual[p.id] && (
                      <p className="text-xs mt-1">
                        Cliente elegido:{" "}
                        {
                          clientes.find(
                            (c) =>
                              c.id ===
                              clienteManual[p.id]
                          )?.name
                        }
                      </p>
                    )}
                  </div>

                  {/* BOTONES */}
                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <button
                      onClick={() => aceptar(p)}
                      disabled={procesando === p.id}
                      className="text-xs px-3 py-2.5 rounded-md flex items-center justify-center gap-1.5"
                      style={{
                        background: "#4F6F52",
                        color: "#F7F3EC",
                      }}
                    >
                      <Check size={13} />
                      Aceptar y asignar al cliente
                    </button>

                    <button
                      onClick={() => rechazar(p)}
                      disabled={procesando === p.id}
                      className="text-xs px-3 py-2.5 rounded-md flex items-center justify-center gap-1.5"
                      style={{
                        background: "#F4E3E6",
                        color: "#7A2540",
                      }}
                    >
                      <X size={13} />
                      Rechazar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {pedidosPendientes.length === 0 && (
          <p
            className="text-sm"
            style={{ color: "#5B4E5E" }}
          >
            No hay pedidos pendientes del catálogo.
          </p>
        )}

        {/* FILTRO POR FECHA */}
        <div className="mt-7">
          <div
            className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5 p-3 rounded-md"
            style={{
              background: "#F7F3EC",
              border: "1px solid #D9D0C2",
            }}
          >
            <div>
              <p className="text-sm font-medium">
                Buscar pedidos por fecha
              </p>

              <p
                className="text-xs mt-1"
                style={{ color: "#5B4E5E" }}
              >
                Al entrar se muestran solo los pedidos de hoy.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span
                  className="block mb-1"
                  style={{ color: "#5B4E5E" }}
                >
                  Desde
                </span>

                <input
                  type="date"
                  value={fechaDesde}
                  onChange={(e) =>
                    setFechaDesde(e.target.value)
                  }
                  className="px-3 py-2 rounded outline-none"
                  style={{
                    background: "#FFF",
                    border: "1px solid #D9D0C2",
                  }}
                />
              </label>

              <span
                className="pb-2 text-xs"
                style={{ color: "#5B4E5E" }}
              >
                a
              </span>

              <label className="text-xs">
                <span
                  className="block mb-1"
                  style={{ color: "#5B4E5E" }}
                >
                  Hasta
                </span>

                <input
                  type="date"
                  value={fechaHasta}
                  min={fechaDesde}
                  onChange={(e) =>
                    setFechaHasta(e.target.value)
                  }
                  className="px-3 py-2 rounded outline-none"
                  style={{
                    background: "#FFF",
                    border: "1px solid #D9D0C2",
                  }}
                />
              </label>
            </div>
          </div>

          {/* ARCHIVO DE PEDIDOS ACEPTADOS */}
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen size={18} />

            <div>
              <p className="font-serif text-lg">
                Archivo de pedidos del catálogo
              </p>

              <p
                className="text-xs"
                style={{ color: "#5B4E5E" }}
              >
                Pedidos aceptados organizados por fecha.
                Puedes abrir el pedido para revisar y ampliar
                las fotos.
              </p>
            </div>
          </div>

          {Object.entries(archivadosPorFecha).map(
            ([fecha, lista]) => (
              <div key={fecha} className="mb-5">
                <p
                  className="text-sm font-medium px-3 py-2 rounded-t-md"
                  style={{
                    background: "#EDE7DE",
                    color: "#5B4E5E",
                    border: "1px solid #D9D0C2",
                  }}
                >
                  {fecha} · {lista.length} pedido
                  {lista.length === 1 ? "" : "s"}
                </p>

                <div className="flex flex-col gap-2 mt-2">
                  {lista.map((p: any) => {
                    const totalUnidades = p.items.reduce(
                      (
                        t: number,
                        it: ItemPedido
                      ) => t + it.cantidadOriginal,
                      0
                    );

                    const total = p.items.reduce(
                      (
                        t: number,
                        it: ItemPedido
                      ) =>
                        t +
                        it.price *
                          it.cantidadOriginal,
                      0
                    );

                    const abiertoArchivo =
                      pedidoArchivoAbierto === p.id;

                    return (
                      <div
                        key={p.id}
                        className="p-3 rounded-md"
                        style={{
                          background: "#F7F3EC",
                          border:
                            "1px solid #D9D0C2",
                        }}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              Pedido {p.code} ·{" "}
                              {p.customer_name}
                            </p>

                            <p
                              className="text-xs mt-1"
                              style={{
                                color: "#5B4E5E",
                              }}
                            >
                              {p.customer_phone} ·{" "}
                              {new Date(
                                p.created_at
                              ).toLocaleTimeString(
                                "es-BO",
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </p>

                            <p className="text-xs mt-1">
                              {totalUnidades} unidades ·
                              Bs {total.toFixed(2)}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setPedidoArchivoAbierto(
                                  abiertoArchivo
                                    ? null
                                    : p.id
                                )
                              }
                              className="px-4 py-2 rounded-md text-xs font-medium"
                              style={{
                                background:
                                  "#9C7A3C",
                                color: "#F7F3EC",
                              }}
                            >
                              {abiertoArchivo
                                ? "Cerrar pedido"
                                : "Ver pedido"}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                abrirPdfPedido(p)
                              }
                              className="px-4 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-2"
                              style={{
                                background:
                                  "#EDE7DE",
                                color: "#5B4E5E",
                                border:
                                  "1px solid #D9D0C2",
                              }}
                            >
                              <FileText size={14} />
                              PDF
                            </button>
                          </div>
                        </div>

                        {/* LISTA VISUAL DEL PEDIDO */}
                        {abiertoArchivo && (
                          <div
                            className="mt-3 pt-3 flex flex-col gap-2"
                            style={{
                              borderTop:
                                "1px solid #D9D0C2",
                            }}
                          >
                            {agruparItemsVisual(p.items).map((grupo) => (
                              <div
                                key={grupo.key}
                                className="p-2 rounded-md flex gap-3"
                                style={{
                                  background: "#EDE7DE",
                                  border: "1px solid #D9D0C2",
                                }}
                              >
                                {grupo.image_url ? (
                                  <img
                                    src={grupo.image_url}
                                    alt={grupo.name}
                                    onClick={() => {
                                      setImagenAmpliada(grupo.image_url);
                                      imagenAmpliadaRef.current = grupo.image_url;
                                      window.history.pushState(
                                        { fotoPedido: true },
                                        ""
                                      );
                                    }}
                                    className="w-24 h-24 rounded-md object-cover cursor-zoom-in shrink-0"
                                    style={{ border: "1px solid #D9D0C2" }}
                                  />
                                ) : (
                                  <div
                                    className="w-24 h-24 rounded-md flex items-center justify-center text-xs shrink-0"
                                    style={{
                                      background: "#F7F3EC",
                                      border: "1px solid #D9D0C2",
                                      color: "#5B4E5E",
                                    }}
                                  >
                                    Sin foto
                                  </div>
                                )}

                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium">
                                    {grupo.code}
                                  </p>

                                  <p className="text-xs mt-1">
                                    {grupo.name}
                                  </p>

                                  {grupo.variantes.map((v) => (
                                    <p
                                      key={v.texto}
                                      className="text-xs mt-1 font-medium"
                                      style={{ color: "#7A5F2D" }}
                                    >
                                      {v.texto} × {v.cantidad}
                                    </p>
                                  ))}

                                  <p
                                    className="text-xs mt-1"
                                    style={{ color: "#5B4E5E" }}
                                  >
                                    Cantidad total: {grupo.cantidadTotal}
                                  </p>

                                  <p
                                    className="text-xs mt-1"
                                    style={{ color: "#5B4E5E" }}
                                  >
                                    Precio: Bs {grupo.price}
                                  </p>

                                  <p className="text-xs mt-1 font-medium">
                                    Subtotal: Bs {grupo.subtotal.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {pedidosArchivadosFiltrados.length ===
            0 && (
            <p
              className="text-sm"
              style={{ color: "#5B4E5E" }}
            >
              No hay pedidos aceptados en las fechas
              seleccionadas.
            </p>
          )}

          {/* PEDIDOS RECHAZADOS */}
          <div
            className="mt-8 pt-5"
            style={{
              borderTop: "1px solid #D9D0C2",
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen size={18} />

              <div>
                <p className="font-serif text-lg">
                  Pedidos rechazados
                </p>

                <p
                  className="text-xs"
                  style={{ color: "#5B4E5E" }}
                >
                  Subcarpeta separada para los pedidos
                  rechazados, organizada por fecha.
                </p>
              </div>
            </div>

            {Object.entries(rechazadosPorFecha).map(
              ([fecha, lista]) => (
                <div key={fecha} className="mb-5">
                  <p
                    className="text-sm font-medium px-3 py-2 rounded-t-md"
                    style={{
                      background: "#F4E3E6",
                      color: "#7A2540",
                      border: "1px solid #E5C7CF",
                    }}
                  >
                    {fecha} · {lista.length} rechazado
                    {lista.length === 1 ? "" : "s"}
                  </p>

                  <div className="flex flex-col gap-2 mt-2">
                    {lista.map((p: any) => {
                      const abiertoRechazado =
                        pedidoArchivoAbierto === p.id;

                      return (
                        <div
                          key={p.id}
                          className="p-3 rounded-md"
                          style={{
                            background: "#FFF7F8",
                            border:
                              "1px solid #E5C7CF",
                          }}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">
                                Pedido {p.code} ·{" "}
                                {p.customer_name}
                              </p>

                              <p
                                className="text-xs mt-1"
                                style={{
                                  color:
                                    "#5B4E5E",
                                }}
                              >
                                {p.customer_phone} ·{" "}
                                {new Date(
                                  p.created_at
                                ).toLocaleString(
                                  "es-BO"
                                )}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setPedidoArchivoAbierto(
                                    abiertoRechazado
                                      ? null
                                      : p.id
                                  )
                                }
                                className="px-4 py-2 rounded-md text-xs font-medium"
                                style={{
                                  background:
                                    "#7A2540",
                                  color: "#FFF",
                                }}
                              >
                                {abiertoRechazado
                                  ? "Cerrar pedido"
                                  : "Ver pedido"}
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  abrirPdfPedido(p)
                                }
                                className="px-4 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-2"
                                style={{
                                  background:
                                    "#F4E3E6",
                                  color: "#7A2540",
                                  border:
                                    "1px solid #E5C7CF",
                                }}
                              >
                                <FileText size={14} />
                                PDF
                              </button>
                            </div>
                          </div>

                          {abiertoRechazado && (
                            <div
                              className="mt-3 pt-3 flex flex-col gap-2"
                              style={{
                                borderTop:
                                  "1px solid #E5C7CF",
                              }}
                            >
                              {agruparItemsVisual(p.items).map((grupo) => (
                                <div
                                  key={grupo.key}
                                  className="p-2 rounded-md flex gap-3"
                                  style={{
                                    background: "#F7F3EC",
                                    border: "1px solid #D9D0C2",
                                  }}
                                >
                                  {grupo.image_url ? (
                                    <img
                                      src={grupo.image_url}
                                      alt={grupo.name}
                                      onClick={() => {
                                        setImagenAmpliada(grupo.image_url);
                                        imagenAmpliadaRef.current = grupo.image_url;
                                        window.history.pushState(
                                          { fotoPedido: true },
                                          ""
                                        );
                                      }}
                                      className="w-24 h-24 rounded-md object-cover cursor-zoom-in shrink-0"
                                      style={{ border: "1px solid #D9D0C2" }}
                                    />
                                  ) : (
                                    <div
                                      className="w-24 h-24 rounded-md flex items-center justify-center text-xs shrink-0"
                                      style={{
                                        background: "#FFF",
                                        border: "1px solid #D9D0C2",
                                        color: "#5B4E5E",
                                      }}
                                    >
                                      Sin foto
                                    </div>
                                  )}

                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium">
                                      {grupo.code}
                                    </p>

                                    <p className="text-xs mt-1">
                                      {grupo.name}
                                    </p>

                                    {grupo.variantes.map((v) => (
                                      <p
                                        key={v.texto}
                                        className="text-xs mt-1 font-medium"
                                        style={{ color: "#7A5F2D" }}
                                      >
                                        {v.texto} × {v.cantidad}
                                      </p>
                                    ))}

                                    <p
                                      className="text-xs mt-1"
                                      style={{ color: "#5B4E5E" }}
                                    >
                                      Cantidad total: {grupo.cantidadTotal}
                                    </p>

                                    <p
                                      className="text-xs mt-1"
                                      style={{ color: "#5B4E5E" }}
                                    >
                                      Precio: Bs {grupo.price}
                                    </p>

                                    <p className="text-xs mt-1 font-medium">
                                      Subtotal: Bs {grupo.subtotal.toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            )}

            {pedidosRechazadosFiltrados.length ===
              0 && (
              <p
                className="text-sm"
                style={{ color: "#5B4E5E" }}
              >
                No hay pedidos rechazados en las fechas
                seleccionadas.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* FOTO AMPLIADA */}
      {imagenAmpliada && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{
            background: "rgba(0,0,0,0.88)",
          }}
          onClick={() => {
            setImagenAmpliada(null);
            imagenAmpliadaRef.current = null;
          }}
        >
          <button
            type="button"
            onClick={() => {
              setImagenAmpliada(null);
              imagenAmpliadaRef.current = null;
            }}
            className="absolute top-4 right-4 w-10 h-10 rounded-full text-2xl flex items-center justify-center"
            style={{
              background: "#F7F3EC",
              color: "#5B4E5E",
            }}
          >
            ×
          </button>

          <img
            src={imagenAmpliada}
            alt="Producto ampliado"
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
