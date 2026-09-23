import { supabase } from "./supabase";

export interface PricingRule {
  id: string;
  category_id: string | null;
  grouping_type: "category" | "model";
  min_quantity: number;
  discount_per_unit: number;
  active: boolean;
}

// Trae las reglas configurables desde la tabla pricing_rules (Configuración → Reglas de precio,
// en una futura pantalla). Si algo falla, se usan las reglas por defecto como respaldo.
export async function loadPricingRules(): Promise<PricingRule[]> {
  const { data, error } = await supabase
    .from("pricing_rules")
    .select("*")
    .eq("active", true)
    .order("min_quantity", { ascending: true });
  if (error || !data) return [];
  return data as PricingRule[];
}

export interface LineaPedido {
  id: string;
  product_id: string;
  codigo: string;
  nombre: string;
  categoria_id: string | null;
  cantidad: number;
  precio_base: number;
  fecha: string;
  vendedorNombre?: string | null;
  imagen?: string | null;
}

export interface GrupoProducto {
  product_id: string;
  codigo: string;
  nombre: string;
  categoria_id: string | null;
  cantidadTotal: number;
  precioUnitarioFinal: number;
  subtotalSinDescuento: number;
  subtotalConDescuento: number;
  descuento: number;
  imagen: string | null;
  detalle: { id: string; cantidad: number; fecha: string; vendedorNombre?: string | null }[];
}

// Agrupa las líneas de un pedido por producto (mismo código), sumando la cantidad
// de TODAS las fechas en que se asignó ese producto dentro del pedido abierto, y
// calcula el descuento sobre esa cantidad acumulada — no por cada asignación suelta.
export function agruparPorProducto(reglas: PricingRule[], lineas: LineaPedido[]): GrupoProducto[] {
  const grupos = new Map<string, GrupoProducto>();
  for (const l of lineas) {
    let g = grupos.get(l.product_id);
    if (!g) {
      g = {
        product_id: l.product_id,
        codigo: l.codigo,
        nombre: l.nombre,
        categoria_id: l.categoria_id,
        cantidadTotal: 0,
        precioUnitarioFinal: l.precio_base,
        subtotalSinDescuento: 0,
        subtotalConDescuento: 0,
        descuento: 0,
        imagen: l.imagen ?? null,
        detalle: [],
      };
      grupos.set(l.product_id, g);
    }
    if (!g.imagen && l.imagen) g.imagen = l.imagen;
    g.cantidadTotal += l.cantidad;
    g.subtotalSinDescuento += l.precio_base * l.cantidad;
    g.detalle.push({ id: l.id, cantidad: l.cantidad, fecha: l.fecha, vendedorNombre: l.vendedorNombre });
  }
  for (const g of grupos.values()) {
    const base = g.subtotalSinDescuento / g.cantidadTotal;
    g.precioUnitarioFinal = precioUnitario(reglas, g.categoria_id, g.cantidadTotal, base);
    g.subtotalConDescuento = g.precioUnitarioFinal * g.cantidadTotal;
    g.descuento = g.subtotalSinDescuento - g.subtotalConDescuento;
    // Se conservan las líneas reales y sus IDs. La UI puede resumir fechas,
    // pero las operaciones +/-/eliminar deben apuntar a filas reales de order_items.
  }
  return Array.from(grupos.values());
}
export function precioUnitario(
  reglas: PricingRule[],
  categoryId: string | null,
  cantidad: number,
  base: number
): number {
  const aplicables = reglas.filter(
    (r) => (r.category_id === categoryId || r.category_id === null) && cantidad >= r.min_quantity
  );
  if (aplicables.length === 0) return base;
  const mejor = aplicables.reduce((a, b) => (b.min_quantity > a.min_quantity ? b : a));
  return Math.max(0, base - mejor.discount_per_unit);
}
