-- LOVES STORIES 1.0 — LIMPIEZA FINAL PARA LANZAMIENTO
-- ADVERTENCIA: IRREVERSIBLE.
-- Deja el sistema sin clientes, vendedores, productos, lotes, ventas, pedidos,
-- depósitos, devoluciones, catálogo, movimientos, auditoría ni sesiones de prueba.
-- CONSERVA: perfiles/usuarios de acceso, configuración del negocio, categorías
-- y reglas de precios/descuentos.
-- Ejecutar UNA SOLA VEZ justo antes del lanzamiento, después de probar la Corrección 23.

begin;

truncate table
  public.return_items,
  public.returns,
  public.catalog_submission_items,
  public.catalog_reservations,
  public.catalog_submissions,
  public.catalog_products,
  public.pdf_versions,
  public.order_item_history,
  public.inventory_movements,
  public.payments,
  public.order_items,
  public.sales_sessions,
  public.orders,
  public.price_history,
  public.products,
  public.purchase_batches,
  public.customers,
  public.sellers,
  public.audit_log,
  public.login_log
restart identity cascade;

commit;

-- COMPROBACIÓN: todas estas cantidades deben devolver 0.
select
  (select count(*) from public.customers) as clientes,
  (select count(*) from public.sellers) as vendedores,
  (select count(*) from public.products) as productos,
  (select count(*) from public.purchase_batches) as lotes,
  (select count(*) from public.orders) as pedidos,
  (select count(*) from public.order_items) as items_pedido,
  (select count(*) from public.payments) as pagos_depositos,
  (select count(*) from public.returns) as devoluciones,
  (select count(*) from public.catalog_submissions) as pedidos_catalogo,
  (select count(*) from public.inventory_movements) as movimientos;
