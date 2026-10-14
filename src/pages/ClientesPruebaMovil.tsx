import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type ClientePrueba = {
  id: string;
  name: string;
  phone: string | null;
};

type PedidoPrueba = {
  id: string;
  customer_id: string;
  opened_at: string;
};

type FilaPrueba = {
  id: string;
  product_id: string;
  quantity: number;
  assigned_at: string;
  products: { code: string | null; name: string | null } | null;
};

type GrupoPrueba = {
  product_id: string;
  code: string;
  name: string;
  quantity: number;
  latestDate: string;
};

export default function ClientesPruebaMovil() {
  const [clientes, setClientes] = useState<ClientePrueba[]>([]);
  const [pedidos, setPedidos] = useState<PedidoPrueba[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [grupos, setGrupos] = useState<GrupoPrueba[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(true);
  const [cargandoItems, setCargandoItems] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let activa = true;

    async function cargarCuentas() {
      setCargandoClientes(true);
      setError("");

      const [{ data: clientesData, error: errorClientes }, { data: pedidosData, error: errorPedidos }] = await Promise.all([
        supabase.from("customers").select("id, name, phone").is("deleted_at", null).order("name"),
        supabase.from("orders").select("id, customer_id, opened_at").in("status", ["open", "reopened"]).order("opened_at", { ascending: false }),
      ]);

      if (!activa) return;
      if (errorClientes || errorPedidos) {
        setError("No se pudieron cargar las cuentas para la prueba.");
        setCargandoClientes(false);
        return;
      }

      const listaClientes = (clientesData ?? []) as ClientePrueba[];
      const listaPedidos = (pedidosData ?? []) as PedidoPrueba[];
      const idsConPedido = new Set(listaPedidos.map((pedido) => pedido.customer_id));
      const listaConPedido = listaClientes.filter((cliente) => idsConPedido.has(cliente.id));

      setClientes(listaConPedido);
      setPedidos(listaPedidos);
      setClienteId(listaConPedido[0]?.id ?? "");
      setCargandoClientes(false);
    }

    void cargarCuentas();
    return () => { activa = false; };
  }, []);

  useEffect(() => {
    let activa = true;

    async function cargarItems() {
      const pedido = pedidos.find((item) => item.customer_id === clienteId);
      setGrupos([]);
      setError("");

      if (!clienteId || !pedido) {
        setCargandoItems(false);
        return;
      }

      setCargandoItems(true);
      const { data, error: errorItems } = await supabase
        .from("order_items")
        .select("id, product_id, quantity, assigned_at, products(code, name)")
        .eq("order_id", pedido.id)
        .order("assigned_at", { ascending: true });

      if (!activa) return;
      if (errorItems) {
        setError("No se pudieron cargar los productos de esta cuenta.");
        setCargandoItems(false);
        return;
      }

      const agrupados = new Map<string, GrupoPrueba>();
      for (const fila of (data ?? []) as FilaPrueba[]) {
        const producto = agrupados.get(fila.product_id);
        const nombreFecha = new Date(fila.assigned_at).toLocaleDateString("es-BO");
        if (producto) {
          producto.quantity += Number(fila.quantity ?? 0);
          producto.latestDate = nombreFecha;
        } else {
          agrupados.set(fila.product_id, {
            product_id: fila.product_id,
            code: fila.products?.code ?? "",
            name: fila.products?.name ?? "",
            quantity: Number(fila.quantity ?? 0),
            latestDate: nombreFecha,
          });
        }
      }

      setGrupos(Array.from(agrupados.values()));
      setCargandoItems(false);
    }

    void cargarItems();
    return () => { activa = false; };
  }, [clienteId, pedidos]);

  const clienteSeleccionado = clientes.find((cliente) => cliente.id === clienteId);

  return (
    <main className="ls-clientes-mobile-test">
      <section className="mb-3 rounded-md border p-4" style={{ background: "#F7F3EC", borderColor: "#D9D0C2" }}>
        <h1 className="font-serif text-lg">Prueba de desplazamiento de productos</h1>
        <p className="mt-1 text-sm" style={{ color: "#5B4E5E" }}>
          Esta pantalla temporal es solo de lectura. La página Clientes habitual permanece intacta.
          Desliza el dedo dentro de la lista de productos.
        </p>
        <label htmlFor="cliente-prueba-movil" className="mt-3 block text-sm">Cuenta con pedido abierto</label>
        <select
          id="cliente-prueba-movil"
          value={clienteId}
          onChange={(event) => setClienteId(event.target.value)}
          disabled={cargandoClientes || clientes.length === 0}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          style={{ background: "#fff", borderColor: "#D9D0C2" }}
        >
          {clientes.length === 0 && <option value="">No hay cuentas abiertas</option>}
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>{cliente.name} · {cliente.phone ?? ""}</option>
          ))}
        </select>
      </section>

      <section className="rounded-md border" style={{ background: "#F7F3EC", borderColor: "#D9D0C2" }}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "#D9D0C2" }}>
          <div>
            <h2 className="font-serif text-base">Productos de {clienteSeleccionado?.name ?? "la cuenta"}</h2>
            <p className="text-xs" style={{ color: "#5B4E5E" }}>
              {cargandoItems ? "Cargando…" : `${grupos.length} productos · solo lectura`}
            </p>
          </div>
        </div>

        {error && <p role="alert" className="p-4 text-sm">{error}</p>}
        {!error && !cargandoClientes && clientes.length === 0 && (
          <p className="p-4 text-sm">No hay cuentas abiertas para probar.</p>
        )}
        {!error && clientes.length > 0 && !cargandoItems && grupos.length === 0 && (
          <p className="p-4 text-sm">Esta cuenta no tiene productos.</p>
        )}

        <div className="ls-clientes-mobile-test-items">
          {grupos.map((grupo) => (
            <article key={grupo.product_id} className="border-b px-4 py-3" style={{ borderColor: "#D9D0C2" }}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm">{grupo.code} · {grupo.name} × {grupo.quantity}</p>
                <span className="shrink-0 text-xs" style={{ color: "#5B4E5E" }}>{grupo.latestDate}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
