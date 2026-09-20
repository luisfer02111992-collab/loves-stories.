-- =========================================================
-- LOVES STORIES — LIMPIEZA DEL CLIENTE DE PRUEBA "nano"
-- (LIMPIEZA_CLIENTE_PRUEBA.sql)
--
-- Este archivo es SOLO PARA REVISIÓN MANUAL. NO lo pegues completo de
-- corrido. NO está incluido en ninguna migración automática.
-- Corrige los 2 movimientos "cierre_pedido" de Bs 25 que el bug del
-- punto 9 generó por error para el cliente "nano" (ya corregido en el
-- código — ver supabase_migration_CORRECCION_2.sql).
-- =========================================================

-- PASO 1 — Ejecuta SOLO este SELECT primero, para confirmar que son
-- exactamente esos 2 movimientos (y ningún otro) antes de tocar nada.
select p.id, p.customer_id, p.order_id, p.amount, p.method, p.paid_at
from public.payments p
join public.customers c on c.id = p.customer_id
where c.name = 'nano'
  and p.method = 'cierre_pedido'
  and p.amount = 25
order by p.paid_at;

-- Revisa el resultado: debe mostrar exactamente 2 filas, ambas del 17/9/2026,
-- Bs 25, method = 'cierre_pedido'. Copia sus "id" para el paso 2.

-- PASO 2 — Con los "id" confirmados del paso 1, borra ESOS DOS registros
-- puntuales (nunca un DELETE general por nombre/monto/método, para no
-- arriesgar tocar un cierre_pedido legítimo de otro pedido). Reemplaza
-- 'ID-1-AQUI' y 'ID-2-AQUI' por los valores reales antes de ejecutar.
--
-- delete from public.payments
-- where id in ('ID-1-AQUI', 'ID-2-AQUI');

-- PASO 3 (opcional pero recomendado) — Dado que esos 2 pagos estaban
-- asociados a pedidos que ya quedaron con total_cerrado calculado sobre
-- datos incorrectos, después de borrarlos puedes querer revisar esos
-- pedidos en Ventas → Editar (corregir) → Guardar cambios, para que
-- total_cerrado quede recalculado limpio. Esto no requiere SQL, se hace
-- desde la pantalla de Ventas.

-- =========================================================
-- FIN — revisar y ejecutar manualmente, paso por paso.
-- =========================================================
