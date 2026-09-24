export const PERMISSION_OPTIONS = [
  { key: "asignar", label: "Asignar / Vender" }, { key: "resumen", label: "Resumen" },
  { key: "clientes", label: "Clientes" }, { key: "reportes_dia", label: "Reportes del día" },
  { key: "productos", label: "Productos" }, { key: "inventario", label: "Inventario" },
  { key: "compras", label: "Compras / Lotes" }, { key: "asignacion_multiple", label: "Asignar a varios" },
  { key: "catalogo", label: "Catálogo" }, { key: "pedidos_catalogo", label: "Pedidos del catálogo" },
  { key: "ventas", label: "Ventas" }, { key: "historial_clientes", label: "Historial de clientes" },
  { key: "cierre_caja", label: "Cierre de caja" }, { key: "reportes", label: "Reportes" },
  { key: "vendedores", label: "Vendedores" }, { key: "reporte_vendedores", label: "Reporte de vendedores" },
  { key: "configuracion", label: "Configuración" },
] as const;
export type PermissionKey = typeof PERMISSION_OPTIONS[number]["key"];
export const EMPLOYEE_DEFAULT_PERMISSIONS: PermissionKey[] = ["asignar","resumen","clientes","reportes_dia","productos","inventario","asignacion_multiple","catalogo","pedidos_catalogo","ventas","historial_clientes"];
export function canAccess(role:string|undefined, permissions:string[]|null|undefined, key:PermissionKey){ if(role==="admin") return true; return (permissions ?? EMPLOYEE_DEFAULT_PERMISSIONS).includes(key); }
