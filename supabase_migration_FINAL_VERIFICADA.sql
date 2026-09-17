-- =========================================================
-- LOVES STORIES — MIGRACIÓN ACTUALIZACIÓN INTEGRAL
-- (supabase_migration_update.sql)
-- Pega este archivo COMPLETO en Supabase → SQL Editor → New query → Run.
-- Incluye TODO lo de las versiones anteriores otra vez (de forma segura, con
-- "if not exists"/"create or replace") MÁS lo nuevo de esta entrega: sistema
-- de vendedores y sesiones/turnos, venta directa sin cliente, y comisiones.
-- No hay ningún DELETE FROM de datos de negocio en todo este archivo (los
-- mismos 3 DELETE FROM catalog_reservations de siempre — solo apartados
-- temporales de 5 min). Los únicos DROP son DROP POLICY/FUNCTION/TRIGGER,
-- nunca DROP TABLE, y nunca borran filas. Se explica cada uno donde aparece.
-- =========================================================

-- ---------------------------------------------------------
-- 1) Imagen en el producto maestro
-- ---------------------------------------------------------
alter table public.products add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('imagenes', 'imagenes', true)
on conflict (id) do nothing;

drop policy if exists "imagenes_lectura_publica" on storage.objects;
create policy "imagenes_lectura_publica" on storage.objects
  for select using (bucket_id = 'imagenes');

drop policy if exists "imagenes_escritura_staff" on storage.objects;
create policy "imagenes_escritura_staff" on storage.objects
  for insert with check (bucket_id = 'imagenes' and public.is_staff());

drop policy if exists "imagenes_borrado_staff" on storage.objects;
create policy "imagenes_borrado_staff" on storage.objects
  for delete using (bucket_id = 'imagenes' and public.is_staff());

-- ---------------------------------------------------------
-- 2) Reglas de descuento: NO SE TOCAN (se mantiene igual que V3, solo lectura).
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- 3) Reserva del catálogo público: 5 minutos.
-- ---------------------------------------------------------
create or replace function public.catalog_reserve(p_catalog_product_id uuid, p_session_id text, p_quantity int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_stock int; v_reservado int; v_disponible int;
begin
  select stock_available into v_stock from public.catalog_products where id = p_catalog_product_id for update;

  select coalesce(sum(quantity),0) into v_reservado
  from public.catalog_reservations
  where catalog_product_id = p_catalog_product_id and expires_at > now() and session_id <> p_session_id;

  v_disponible := v_stock - v_reservado;
  if v_disponible < p_quantity then
    return false;
  end if;

  delete from public.catalog_reservations
  where catalog_product_id = p_catalog_product_id and session_id = p_session_id;

  insert into public.catalog_reservations (catalog_product_id, session_id, quantity, expires_at)
  values (p_catalog_product_id, p_session_id, p_quantity, now() + interval '5 minutes');

  return true;
end;
$$;

-- ---------------------------------------------------------
-- 4) "Carpeta de pedidos" del catálogo público
-- ---------------------------------------------------------
alter table public.catalog_submissions add column if not exists session_id text;
alter table public.catalog_submissions add column if not exists order_id uuid references public.orders(id);
alter table public.catalog_submissions add column if not exists notes text;

create or replace function public.accept_catalog_submission(
  p_submission_id uuid, p_customer_id uuid, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid; v_session_id text; v_item jsonb;
  v_catalog_product_id uuid; v_quantity int; v_product_id uuid;
begin
  select session_id into v_session_id from public.catalog_submissions where id = p_submission_id;

  select id into v_order_id from public.orders
  where customer_id = p_customer_id and status in ('open','reopened')
  order by opened_at desc limit 1;

  if v_order_id is null then
    insert into public.orders (customer_id) values (p_customer_id) returning id into v_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_catalog_product_id := (v_item->>'catalog_product_id')::uuid;
    v_quantity := (v_item->>'quantity')::int;
    if v_quantity > 0 then
      select product_id into v_product_id from public.catalog_products where id = v_catalog_product_id;
      if v_product_id is not null then
        perform public.assign_product_to_order(v_order_id, v_product_id, v_quantity, 'catalogo');
      end if;
      update public.catalog_products
        set stock_available = greatest(0, stock_available - v_quantity)
        where id = v_catalog_product_id;
    end if;
    delete from public.catalog_reservations
      where catalog_product_id = v_catalog_product_id and session_id = v_session_id;
  end loop;

  update public.catalog_submissions set status = 'attached', order_id = v_order_id where id = p_submission_id;
  return v_order_id;
end;
$$;

create or replace function public.discard_catalog_submission(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_session_id text;
begin
  select session_id into v_session_id from public.catalog_submissions where id = p_submission_id;
  delete from public.catalog_reservations where session_id = v_session_id;
  update public.catalog_submissions set status = 'discarded' where id = p_submission_id;
end;
$$;

revoke all on function public.accept_catalog_submission(uuid, uuid, jsonb) from public;
grant execute on function public.accept_catalog_submission(uuid, uuid, jsonb) to authenticated;
revoke all on function public.discard_catalog_submission(uuid) from public;
grant execute on function public.discard_catalog_submission(uuid) to authenticated;

-- ---------------------------------------------------------
-- 5) Apariencia del sistema (Configuración)
-- ---------------------------------------------------------
alter table public.app_settings add column if not exists theme_preset text not null default 'clasico';
alter table public.app_settings add column if not exists color_primario text not null default '#9C7A3C';
alter table public.app_settings add column if not exists color_acento text not null default '#4F6F52';
alter table public.app_settings add column if not exists estilo_barra text not null default 'solido';

-- ---------------------------------------------------------
-- 6) Lotes: CORREGIDO EN V4. Eliminar un lote retira del inventario activo
--    TODOS sus productos (borrado lógico, deleted_at) — tengan o no historial
--    de ventas. Nunca se borra físicamente ninguna fila: si un producto tiene
--    historial, order_items/returns/inventory_movements siguen apuntando al
--    mismo id y ese producto sigue viéndose perfecto en Ventas/Reportes/PDF,
--    solo deja de listarse como inventario activo/disponible.
-- ---------------------------------------------------------
alter table public.purchase_batches add column if not exists deleted_at timestamptz;

-- Solo consulta (no modifica nada): qué productos de un lote se retirarían,
-- e indica cuáles de ellos tienen historial de ventas (para que se vea claro
-- en la confirmación que esos productos no pierden su historial, solo dejan
-- de estar activos).
create or replace function public.productos_retirables_por_lote(p_batch_id uuid)
returns table(id uuid, code text, name text, tiene_historial boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.code, p.name,
    exists(select 1 from public.order_items oi where oi.product_id = p.id) as tiene_historial
  from public.products p
  where p.batch_id = p_batch_id
    and p.deleted_at is null;
$$;

-- Elimina el lote (borrado lógico) y retira del inventario activo (borrado
-- lógico, deleted_at) TODOS los productos de ese lote, tengan o no historial.
-- Nunca hace DELETE físico. Todo en una sola función/transacción.
create or replace function public.eliminar_lote(p_batch_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar lotes';
  end if;

  update public.products
    set deleted_at = now()
    where batch_id = p_batch_id
      and deleted_at is null;
  get diagnostics v_count = row_count;

  update public.purchase_batches set deleted_at = now() where id = p_batch_id;

  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'lote_eliminado', jsonb_build_object('batch_id', p_batch_id, 'productos_retirados', v_count));

  return v_count;
end;
$$;

revoke all on function public.productos_retirables_por_lote(uuid) from public;
grant execute on function public.productos_retirables_por_lote(uuid) to authenticated;
revoke all on function public.eliminar_lote(uuid) from public;
grant execute on function public.eliminar_lote(uuid) to authenticated;

-- ---------------------------------------------------------
-- 7) Total de la venta calculado y validado EN SUPABASE. Se agrega
--    orders.total_original (el total con el que se cerró la venta la
--    PRIMERA vez, nunca se vuelve a tocar) además de orders.total_cerrado
--    (el total vigente/corregido, este sí se actualiza si corriges un error).
-- ---------------------------------------------------------
alter table public.orders add column if not exists total_cerrado numeric(12,2);
alter table public.orders add column if not exists total_original numeric(12,2);

drop function if exists public.close_order(uuid, numeric);

create or replace function public.calcular_total_pedido(p_order_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_total numeric(12,2) := 0;
begin
  select coalesce(sum(
    greatest(0, (g.subtotal / g.cantidad) - coalesce((
      select pr.discount_per_unit from public.pricing_rules pr
      where pr.active
        and (pr.category_id = g.category_id or pr.category_id is null)
        and pr.min_quantity <= g.cantidad
      order by pr.min_quantity desc
      limit 1
    ), 0)) * g.cantidad
  ), 0) into v_total
  from (
    select oi.product_id, p.category_id, sum(oi.quantity) as cantidad, sum(oi.quantity * oi.unit_price) as subtotal
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
    group by oi.product_id, p.category_id
  ) g;
  return round(v_total, 2);
end;
$$;

create or replace function public.close_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_customer_id uuid; v_status text; v_total numeric(12,2); v_pagado numeric(12,2); v_saldo numeric(12,2);
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede cerrar pedidos';
  end if;

  select customer_id, status into v_customer_id, v_status from public.orders where id = p_order_id for update;
  if v_customer_id is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_status = 'closed' then
    raise exception 'Este pedido ya está cerrado — no se puede volver a cerrar. Si necesitas corregirlo, usa "Editar (corregir)" en Ventas.';
  end if;

  v_total := public.calcular_total_pedido(p_order_id);
  select coalesce(sum(amount),0) into v_pagado from public.payments where order_id = p_order_id;
  v_saldo := v_total - v_pagado;

  if v_saldo > 0 then
    insert into public.payments (customer_id, order_id, amount, method)
    values (v_customer_id, p_order_id, v_saldo, 'cierre_pedido');
  end if;

  -- total_original se fija AQUÍ, la primera y única vez que se cierra el
  -- pedido, y ninguna otra función lo vuelve a tocar nunca.
  update public.orders
    set status = 'closed', closed_at = now(), total_cerrado = v_total, total_original = v_total
    where id = p_order_id;
  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'pedido_cerrado', jsonb_build_object('order_id', p_order_id, 'total_final', v_total));
end;
$$;

revoke all on function public.calcular_total_pedido(uuid) from public;
grant execute on function public.calcular_total_pedido(uuid) to authenticated;
revoke all on function public.close_order(uuid) from public;
grant execute on function public.close_order(uuid) to authenticated;

-- ---------------------------------------------------------
-- 8) DEVOLUCIONES Y CORRECCIÓN DE VENTAS — CORREGIDO EN V4
--
--    Antes (V3, ERROR): al corregir una venta se bajaba total_cerrado Y
--    además se registraba una devolución tipo 'correccion' con la
--    diferencia, así que esa diferencia se restaba DOS VECES en "venta neta".
--
--    Ahora (V4): total_cerrado YA es el total correcto tras la corrección,
--    así que:
--      Venta neta = total_cerrado − devoluciones de PRODUCTO solamente
--                   (las devoluciones tipo 'correccion' NO se vuelven a
--                   restar de la venta neta, porque total_cerrado ya bajó).
--      Cobro neto = cobrado − (devoluciones de producto + reembolsos por
--                   corrección) — porque ambos SÍ son dinero que salió de
--                   la caja, aunque no deban afectar la "venta neta" dos veces.
-- ---------------------------------------------------------
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  customer_id uuid not null references public.customers(id),
  type text not null check (type in ('producto','correccion')),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  reason text,
  observation text,
  status text not null default 'activa' check (status in ('activa','anulada')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text
);

create table if not exists public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete cascade,
  product_id uuid references public.products(id),
  order_item_id uuid references public.order_items(id),
  quantity int not null default 0 check (quantity >= 0),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  reason text not null,
  restock boolean not null default false,
  observation text
);

create index if not exists idx_returns_order on public.returns(order_id);
create index if not exists idx_returns_created_at on public.returns(created_at);
create index if not exists idx_returns_type on public.returns(type);
create index if not exists idx_return_items_return on public.return_items(return_id);

alter table public.returns enable row level security;
alter table public.return_items enable row level security;

drop policy if exists "returns_staff" on public.returns;
create policy "returns_staff" on public.returns for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "return_items_staff" on public.return_items;
create policy "return_items_staff" on public.return_items for all using (public.is_staff()) with check (public.is_staff());

create or replace function public.unidades_ya_devueltas(p_order_item_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(ri.quantity), 0)::int
  from public.return_items ri
  join public.returns r on r.id = ri.return_id
  where ri.order_item_id = p_order_item_id and r.status = 'activa';
$$;

-- B) Devolución real de producto (roto/defectuoso/equivocado). CORREGIDO EN
-- V4 con validaciones de seguridad explícitas: usuario staff, pedido debe
-- estar CERRADO (no se puede "devolver" un producto de un pedido que ni
-- siquiera se ha vendido/cerrado), cantidades y montos positivos, y nunca
-- devolver más de lo vendido menos lo ya devuelto.
create or replace function public.registrar_devolucion_producto(
  p_order_item_id uuid, p_quantity int, p_amount numeric,
  p_reason text, p_restock boolean, p_observation text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid; v_customer_id uuid; v_product_id uuid; v_vendidas int; v_ya_devueltas int;
  v_return_id uuid; v_status text;
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede registrar devoluciones';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad a devolver debe ser mayor a cero';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto a devolver debe ser mayor a cero';
  end if;

  select oi.order_id, oi.product_id, oi.quantity, o.customer_id, o.status
    into v_order_id, v_product_id, v_vendidas, v_customer_id, v_status
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where oi.id = p_order_item_id for update;

  if v_order_id is null then
    raise exception 'No se encontró ese producto dentro de la venta';
  end if;
  if v_status <> 'closed' then
    raise exception 'Solo se pueden registrar devoluciones sobre una VENTA CERRADA (este pedido está % )', v_status;
  end if;

  v_ya_devueltas := public.unidades_ya_devueltas(p_order_item_id);
  if v_ya_devueltas + p_quantity > v_vendidas then
    raise exception 'No puedes devolver más unidades (% ya devueltas) de las % vendidas en esa línea', v_ya_devueltas, v_vendidas;
  end if;

  insert into public.returns (order_id, customer_id, type, total_amount, reason, observation, created_by)
  values (v_order_id, v_customer_id, 'producto', p_amount, p_reason, p_observation, auth.uid())
  returning id into v_return_id;

  insert into public.return_items (return_id, product_id, order_item_id, quantity, amount, reason, restock, observation)
  values (v_return_id, v_product_id, p_order_item_id, p_quantity, p_amount, p_reason, p_restock, p_observation);

  if p_restock then
    update public.products set stock_reserved = greatest(0, stock_reserved - p_quantity), updated_at = now()
    where id = v_product_id;
    insert into public.inventory_movements (product_id, type, quantity_delta, order_id, reason, performed_by)
    values (v_product_id, 'devolucion', p_quantity, v_order_id, p_reason, auth.uid());
  else
    update public.products
      set stock_reserved = greatest(0, stock_reserved - p_quantity),
          stock_physical = greatest(0, stock_physical - p_quantity),
          updated_at = now()
    where id = v_product_id;
    insert into public.inventory_movements (product_id, type, quantity_delta, order_id, reason, performed_by)
    values (v_product_id, 'merma', -p_quantity, v_order_id, concat('Devolución no vendible: ', p_reason), auth.uid());
  end if;

  return v_return_id;
end;
$$;

-- A) Corrección de un error de registro: recalcula y actualiza
-- orders.total_cerrado (total_original NUNCA se toca aquí). Devuelve total
-- original, total anterior, total nuevo, lo pagado y la diferencia — la
-- decisión de qué hacer con esa diferencia la tomas tú.
create or replace function public.recalcular_total_venta(p_order_id uuid)
returns table(total_original numeric, total_anterior numeric, total_nuevo numeric, pagado numeric, diferencia numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_original numeric(12,2); v_anterior numeric(12,2); v_nuevo numeric(12,2); v_pagado numeric(12,2);
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede corregir una venta';
  end if;

  select o.total_original, o.total_cerrado into v_original, v_anterior from public.orders o where o.id = p_order_id for update;
  if v_anterior is null then
    raise exception 'Este pedido no está cerrado, no hay nada que corregir';
  end if;

  v_nuevo := public.calcular_total_pedido(p_order_id);
  select coalesce(sum(amount),0) into v_pagado from public.payments where order_id = p_order_id;

  update public.orders set total_cerrado = v_nuevo where id = p_order_id;
  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'venta_corregida', jsonb_build_object('order_id', p_order_id, 'total_anterior', v_anterior, 'total_nuevo', v_nuevo));

  return query select v_original, v_anterior, v_nuevo, v_pagado, (v_pagado - v_nuevo);
end;
$$;

-- Registra la diferencia de una corrección como REEMBOLSO POR CORRECCIÓN
-- (returns.type = 'correccion'). CORREGIDO: ya no confía en el monto que
-- manda el frontend — calcula y valida en Supabase cuánto corresponde
-- realmente devolver (pagado − total corregido − reembolsos por corrección
-- ya activos), y rechaza si se pide de más o si ya no queda nada pendiente
-- (evita duplicar el mismo reembolso por accidente).
create or replace function public.registrar_devolucion_correccion(
  p_order_id uuid, p_amount numeric, p_observation text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_customer_id uuid; v_status text; v_total_cerrado numeric(12,2); v_pagado numeric(12,2);
  v_ya_reembolsado numeric(12,2); v_maximo numeric(12,2); v_return_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede registrar un reembolso por corrección';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del reembolso debe ser mayor a cero';
  end if;

  select customer_id, status, total_cerrado
    into v_customer_id, v_status, v_total_cerrado
  from public.orders where id = p_order_id for update;

  if v_customer_id is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_status <> 'closed' then
    raise exception 'Solo se puede registrar un reembolso por corrección sobre una VENTA CERRADA (este pedido está % )', v_status;
  end if;

  select coalesce(sum(amount),0) into v_pagado from public.payments where order_id = p_order_id;
  select coalesce(sum(total_amount),0) into v_ya_reembolsado
    from public.returns where order_id = p_order_id and type = 'correccion' and status = 'activa';

  v_maximo := v_pagado - coalesce(v_total_cerrado, 0) - v_ya_reembolsado;

  if v_maximo <= 0 then
    raise exception 'No hay ningún monto pendiente de reembolsar por corrección en este pedido (ya se reembolsó lo que correspondía)';
  end if;
  if p_amount > v_maximo then
    raise exception 'El monto solicitado (Bs %) supera lo que realmente corresponde devolver (Bs %)', p_amount, v_maximo;
  end if;

  insert into public.returns (order_id, customer_id, type, total_amount, reason, observation, created_by)
  values (p_order_id, v_customer_id, 'correccion', p_amount, 'Corrección de registro', p_observation, auth.uid())
  returning id into v_return_id;
  return v_return_id;
end;
$$;

-- Anular una devolución (de cualquier tipo): revierte el efecto sobre stock
-- que tuvo (solo aplica a devoluciones tipo 'producto', que sí tocan stock) y
-- conserva el historial completo de la anulación.
create or replace function public.anular_devolucion(p_return_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_item record;
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede anular una devolución';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Debes indicar el motivo de la anulación';
  end if;
  if not exists (select 1 from public.returns where id = p_return_id and status = 'activa') then
    raise exception 'Esta devolución ya está anulada o no existe';
  end if;

  for v_item in select * from public.return_items where return_id = p_return_id loop
    if v_item.restock then
      update public.products set stock_reserved = stock_reserved + v_item.quantity, updated_at = now()
      where id = v_item.product_id;
    else
      update public.products set stock_physical = stock_physical + v_item.quantity, stock_reserved = stock_reserved + v_item.quantity, updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.returns
    set status = 'anulada', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_motivo
    where id = p_return_id;
end;
$$;

revoke all on function public.registrar_devolucion_producto(uuid, int, numeric, text, boolean, text) from public;
grant execute on function public.registrar_devolucion_producto(uuid, int, numeric, text, boolean, text) to authenticated;
revoke all on function public.recalcular_total_venta(uuid) from public;
grant execute on function public.recalcular_total_venta(uuid) to authenticated;
revoke all on function public.registrar_devolucion_correccion(uuid, numeric, text) from public;
grant execute on function public.registrar_devolucion_correccion(uuid, numeric, text) to authenticated;
revoke all on function public.anular_devolucion(uuid, text) from public;
grant execute on function public.anular_devolucion(uuid, text) to authenticated;
revoke all on function public.unidades_ya_devueltas(uuid) from public;
grant execute on function public.unidades_ya_devueltas(uuid) to authenticated;

-- ---------------------------------------------------------
-- 9) CATÁLOGO: el límite real sigue siendo products.stock_available (sin
--    cambios respecto a V3, se mantiene tal cual).
-- ---------------------------------------------------------
create or replace function public.validar_catalog_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_disponible int;
begin
  if NEW.product_id is not null then
    select stock_available into v_disponible from public.products where id = NEW.product_id;
    if v_disponible is not null and NEW.stock_available > v_disponible then
      NEW.stock_available := v_disponible;
    end if;
  end if;
  if NEW.stock_available < 0 then
    NEW.stock_available := 0;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_validar_catalog_stock on public.catalog_products;
create trigger trg_validar_catalog_stock
  before insert or update on public.catalog_products
  for each row execute function public.validar_catalog_stock();

create or replace function public.sync_catalog_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.catalog_products
    set stock_available = NEW.stock_available
    where product_id = NEW.id and catalog_products.stock_available > NEW.stock_available;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_catalog_stock on public.products;
create trigger trg_sync_catalog_stock
  after update of stock_physical, stock_reserved on public.products
  for each row execute function public.sync_catalog_stock();

update public.catalog_products cp
set stock_available = p.stock_available
from public.products p
where cp.product_id = p.id and cp.stock_available > p.stock_available;

-- =========================================================
-- =========================================================
-- 10) VENDEDORES, SESIONES/TURNOS Y VENTA DIRECTA (nuevo en esta entrega)
-- =========================================================

-- Vendedores: no se borran físicamente nunca, solo se activan/desactivan.
-- Comisión configurable por vendedor: por porcentaje o por monto fijo por
-- unidad. Si no se configura, commission_type se queda en 'none' — el
-- frontend debe mostrar "Comisión no configurada", nunca inventar un valor.
create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  commission_type text not null default 'none' check (commission_type in ('none','percentage','fixed')),
  commission_value numeric(10,2) not null default 0,
  linked_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sesión/turno de vendedor: "Vendedor actual" desde que se inicia hasta que
-- se pulsa "Finalizar sesión". Todo lo asignado en ese intervalo se etiqueta
-- automáticamente con este vendedor, sin tener que elegirlo producto por producto.
create table if not exists public.sales_sessions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by uuid references public.profiles(id),
  notes text
);

create index if not exists idx_sales_sessions_seller on public.sales_sessions(seller_id);

alter table public.sellers enable row level security;
alter table public.sales_sessions enable row level security;

drop policy if exists "sellers_staff_read" on public.sellers;
create policy "sellers_staff_read" on public.sellers for select using (public.is_staff());
drop policy if exists "sellers_admin_write" on public.sellers;
create policy "sellers_admin_write" on public.sellers for insert with check (public.is_admin());
drop policy if exists "sellers_admin_update" on public.sellers;
create policy "sellers_admin_update" on public.sellers for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "sales_sessions_staff" on public.sales_sessions;
create policy "sales_sessions_staff" on public.sales_sessions for all using (public.is_staff()) with check (public.is_staff());

-- Cada línea de pedido (order_item) conserva su propio vendedor y su propia
-- sesión/turno — un mismo pedido puede tener líneas de distintos vendedores
-- en distintos días, y cada una mantiene su responsable real.
alter table public.order_items add column if not exists seller_id uuid references public.sellers(id);
alter table public.order_items add column if not exists session_id uuid references public.sales_sessions(id);
create index if not exists idx_order_items_seller on public.order_items(seller_id);

-- Venta directa: un pedido puede no tener cliente (mostrador/al paso). Nunca
-- se inventa un cliente — customer_id queda NULL y direct_sale queda en true,
-- con un nombre opcional solo para mostrar en el recibo si se escribió uno.
alter table public.orders alter column customer_id drop not null;
alter table public.orders add column if not exists direct_sale boolean not null default false;
alter table public.orders add column if not exists direct_sale_name text;

alter table public.payments alter column customer_id drop not null;

-- assign_product_to_order: se reemplaza por una versión que además etiqueta
-- vendedor y sesión (ambos opcionales — si no hay vendedor activo, quedan
-- NULL y el frontend debe mostrar "Catálogo / Sin vendedor" según corresponda).
-- Se elimina primero la versión anterior de 4 parámetros para que TODO el
-- código (viejo y nuevo) quede resolviendo siempre esta única función.
drop function if exists public.assign_product_to_order(uuid, uuid, int, text);

create or replace function public.assign_product_to_order(
  p_order_id uuid, p_product_id uuid, p_quantity int, p_origin text default 'manual',
  p_seller_id uuid default null, p_session_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_available int;
  v_price numeric(10,2);
begin
  select stock_available, price into v_available, v_price
  from public.products where id = p_product_id for update;

  if v_available < p_quantity then
    raise exception 'No hay suficiente stock disponible (disponible: %, pedido: %)', v_available, p_quantity;
  end if;

  update public.products set stock_reserved = stock_reserved + p_quantity, updated_at = now()
  where id = p_product_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, origin, assigned_by, seller_id, session_id)
  values (p_order_id, p_product_id, p_quantity, v_price, p_origin, auth.uid(), p_seller_id, p_session_id);

  insert into public.order_item_history (order_id, product_id, quantity_delta, unit_price, origin, performed_by)
  values (p_order_id, p_product_id, p_quantity, v_price, p_origin, auth.uid());

  insert into public.inventory_movements (product_id, type, quantity_delta, order_id, performed_by)
  values (p_product_id, 'asignacion', -p_quantity, p_order_id, auth.uid());
end;
$$;

revoke all on function public.assign_product_to_order(uuid, uuid, int, text, uuid, uuid) from public;
grant execute on function public.assign_product_to_order(uuid, uuid, int, text, uuid, uuid) to authenticated;

-- Iniciar sesión/turno de un vendedor. Devuelve el id de la sesión para que
-- el frontend lo guarde mientras esté activa.
create or replace function public.iniciar_sesion_vendedor(p_seller_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede iniciar una sesión de venta';
  end if;
  insert into public.sales_sessions (seller_id, started_by, notes)
  values (p_seller_id, auth.uid(), p_notes)
  returning id into v_id;
  return v_id;
end;
$$;

-- Finalizar sesión/turno.
create or replace function public.finalizar_sesion_vendedor(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede finalizar una sesión de venta';
  end if;
  update public.sales_sessions set ended_at = now() where id = p_session_id and ended_at is null;
end;
$$;

-- Corregir el vendedor de una línea ya asignada (si quedó mal registrada).
-- Deja auditoría completa: vendedor anterior, vendedor nuevo, quién corrigió y cuándo.
create or replace function public.corregir_vendedor_item(p_order_item_id uuid, p_seller_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_anterior uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede corregir el vendedor de una línea';
  end if;
  select seller_id into v_anterior from public.order_items where id = p_order_item_id;
  update public.order_items set seller_id = p_seller_id where id = p_order_item_id;
  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'vendedor_corregido', jsonb_build_object(
    'order_item_id', p_order_item_id, 'vendedor_anterior', v_anterior, 'vendedor_nuevo', p_seller_id, 'motivo', p_motivo
  ));
end;
$$;

revoke all on function public.iniciar_sesion_vendedor(uuid, text) from public;
grant execute on function public.iniciar_sesion_vendedor(uuid, text) to authenticated;
revoke all on function public.finalizar_sesion_vendedor(uuid) from public;
grant execute on function public.finalizar_sesion_vendedor(uuid) to authenticated;
revoke all on function public.corregir_vendedor_item(uuid, uuid, text) from public;
grant execute on function public.corregir_vendedor_item(uuid, uuid, text) to authenticated;

-- close_order: sigue exactamente igual en su lógica de cálculo/pago, solo se
-- vuelve a definir aquí porque ahora debe aceptar pedidos sin cliente (venta
-- directa) — el pago automático del saldo solo se registra si hay customer_id.
create or replace function public.close_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_customer_id uuid; v_status text; v_total numeric(12,2); v_pagado numeric(12,2); v_saldo numeric(12,2);
begin
  if not public.is_staff() then
    raise exception 'Solo un usuario autorizado puede cerrar pedidos';
  end if;

  select customer_id, status into v_customer_id, v_status from public.orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_status = 'closed' then
    raise exception 'Este pedido ya está cerrado — no se puede volver a cerrar. Si necesitas corregirlo, usa "Editar (corregir)" en Ventas.';
  end if;

  v_total := public.calcular_total_pedido(p_order_id);

  if v_customer_id is not null then
    select coalesce(sum(amount),0) into v_pagado from public.payments where order_id = p_order_id;
    v_saldo := v_total - v_pagado;
    if v_saldo > 0 then
      insert into public.payments (customer_id, order_id, amount, method)
      values (v_customer_id, p_order_id, v_saldo, 'cierre_pedido');
    end if;
  end if;

  update public.orders
    set status = 'closed', closed_at = now(), total_cerrado = v_total, total_original = v_total
    where id = p_order_id;
  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'pedido_cerrado', jsonb_build_object('order_id', p_order_id, 'total_final', v_total));
end;
$$;

revoke all on function public.close_order(uuid) from public;
grant execute on function public.close_order(uuid) to authenticated;

-- =========================================================
-- FIN DE LA MIGRACIÓN
-- =========================================================
-- =========================================================
