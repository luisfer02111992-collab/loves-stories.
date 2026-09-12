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

// Calcula el precio por unidad aplicando la regla configurable con mayor cantidad mínima
// que la cantidad pedida cumpla, para la categoría indicada.
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
