import React, { useEffect, useState } from "react";
import { Check, X, Clock, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { CatalogSubmission, Customer } from "../lib/types";

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
  
  useEffect(() => {
    cargar();
    supabase.from("customers").select("*").is("deleted_at", null).order("name").then(({ data }) => setClientes((data as Customer[]) ?? []));
  }, []);

  async function cargar() {
    const { data } = await supabase
      .from("catalog_submissions")
      .select("*, catalog_submission_items(id, catalog_product_id, quantity, variant_key, catalog_products(code, name, variant_type, image_url, price))")
      .eq("status", "pending")
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

  function cambiarCantidad(pedidoId: string, itemId: string, cantidad: number) {
    setPedidos((prev) =>
      prev.map((p) =>
        p.id !== pedidoId
          ? p
          : { ...p, items: p.items.map((it) => (it.id === itemId ? { ...it, cantidadAAsignar: Math.max(0, cantidad) } : it)) }
      )
    );
  }

  function normalizarTelefono(v: string) { return (v ?? "").replace(/\D/g, "").replace(/^591/, ""); }

  function clienteAutomatico(pedido: PedidoConItems) {
    const tel = normalizarTelefono(pedido.customer_phone);
    return clientes.find((c) => normalizarTelefono(c.phone) === tel) ?? null;
  }

  async function aceptar(pedido: PedidoConItems) {
    setProcesando(pedido.id);
    try {
      let cliente: { id: string } | null = null;
      const manualId = clienteManual[pedido.id];
      if (manualId) cliente = { id: manualId };
      if (!cliente) {
        const existente = clienteAutomatico(pedido);
        if (existente) cliente = { id: existente.id };
      }
      if (!cliente) {
        const { data: nuevo, error: errNuevo } = await supabase.from("customers").insert({ name: pedido.customer_name, phone: pedido.customer_phone }).select("id").single();
        if (errNuevo) throw new Error(errNuevo.message);
        cliente = nuevo;
      }
      if (!cliente) throw new Error("No se pudo determinar el cliente.");

      const items = pedido.items.map((it) => ({ catalog_product_id: it.catalog_product_id, quantity: it.cantidadAAsignar, variant_key: it.variant_key }));
      const { error } = await supabase.rpc("accept_catalog_submission", { p_submission_id: pedido.id, p_customer_id: cliente.id, p_items: items });
      if (error) throw new Error(error.message);
      await cargar();
    } catch (err: any) {
      alert(`No se pudo aceptar el pedido: ${err.message}`);
    } finally { setProcesando(null); }
  }

  async function rechazar(pedido: PedidoConItems) {
    if (!confirm(`¿Rechazar el pedido ${pedido.code}? Las unidades reservadas vuelven a estar disponibles.`)) return;
    setProcesando(pedido.id);
    await supabase.rpc("discard_catalog_submission", { p_submission_id: pedido.id });
    setProcesando(null);
    cargar();
  }

  return (
    <div>
      <p className="font-serif text-lg mb-1">Pedidos del catálogo</p>
      <p className="text-xs mb-3" style={{ color: "#5B4E5E" }}>
        Pedidos que tus clientes enviaron desde el link público. Al aceptar, se asignan al cliente en su pedido abierto.
        Si falta o está defectuosa alguna unidad, baja la cantidad antes de aceptar.
      </p>

     <div className="flex flex-col gap-3">
  {pedidos.map((p) => {
    const abierto = pedidoAbierto === p.id;

    const totalPedido = p.items.reduce(
      (total, it) => total + it.price * it.cantidadAAsignar,
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
                  Fecha: {fechaPedido.toLocaleDateString("es-BO")}
                </span>

                <span>
                  <Clock size={11} className="inline -mt-0.5 mr-1" />
                  {fechaPedido.toLocaleTimeString("es-BO", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setPedidoAbierto(abierto ? null : p.id)
              }
              className="px-4 py-2 rounded-md text-xs font-medium shrink-0"
              style={{
                background: abierto ? "#EDE7DE" : "#9C7A3C",
                color: abierto ? "#5B4E5E" : "#F7F3EC",
                border: "1px solid #D9D0C2",
              }}
            >
              {abierto ? "Cerrar detalle" : "Ver detalle"}
            </button>
          </div>
        </div>

        {/* DETALLE DEL PEDIDO */}
        {abierto && (
          <div
            className="p-3"
            style={{ borderTop: "1px solid #D9D0C2" }}
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
                          className="w-20 h-20 rounded-md object-cover"
                          style={{
                            border: "1px solid #D9D0C2",
                          }}
                        />
                      ) : (
                        <div
                          className="w-20 h-20 rounded-md flex items-center justify-center text-xs"
                          style={{
                            background: "#F7F3EC",
                            border: "1px solid #D9D0C2",
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
                          style={{ color: "#7A5F2D" }}
                        >
                          {it.variant_type === "ring_size"
                            ? `Talla ${it.variant_key}`
                            : `${it.variant_key} cm`}
                        </p>
                      )}

                      <p
                        className="text-xs mt-1"
                        style={{ color: "#5B4E5E" }}
                      >
                        Precio: Bs {it.price}
                      </p>

                      <p className="text-xs mt-1 font-medium">
                        Subtotal: Bs{" "}
                        {it.price * it.cantidadAAsignar}
                      </p>
                    </div>
                  </div>

                  {/* CANTIDAD */}
                  <div
                    className="flex items-center justify-between mt-2 pt-2"
                    style={{
                      borderTop: "1px solid #D9D0C2",
                    }}
                  >
                    <span
                      className="text-xs"
                      style={{ color: "#5B4E5E" }}
                    >
                      Cantidad a asignar
                    </span>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={it.cantidadOriginal}
                        value={it.cantidadAAsignar}
                        onChange={(e) =>
                          cambiarCantidad(
                            p.id,
                            it.id,
                            Number(e.target.value)
                          )
                        }
                        className="w-16 px-2 py-1.5 rounded text-sm text-center outline-none"
                        style={{
                          background: "#F7F3EC",
                          border: "1px solid #D9D0C2",
                        }}
                      />

                      <span
                        className="text-xs"
                        style={{ color: "#5B4E5E" }}
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
                        c.name.toLowerCase().includes(q) ||
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
                        c.id === clienteManual[p.id]
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

  {pedidos.length === 0 && (
    <p
      className="text-sm"
      style={{ color: "#5B4E5E" }}
    >
      No hay pedidos pendientes del catálogo.
    </p>
  )}
</div>        
    </div>
  );
}
