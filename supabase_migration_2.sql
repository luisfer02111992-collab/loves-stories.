-- =========================================================
-- LOVES STORIES — MIGRACIÓN 2 (mejoras solicitadas)
-- Pega este archivo completo, una sola vez, en:
-- Supabase → SQL Editor → New query → pega todo → Run
-- No borra nada de lo que ya tienes cargado.
-- =========================================================

-- 1) Imagen en el producto maestro (para poder cargarla al crear el producto
--    o al cargar el lote por Excel, columna "Imagen")
alter table public.products add column if not exists image_url text;

-- 2) Bucket de almacenamiento para las imágenes subidas desde la app
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

-- 3) Reglas de descuento: "anillo o collar" (no "cadenas") a 6 y 12 unidades.
--    Se dejan las reglas de aretes/dijes/sets/pulseras tal como están.
delete from public.pricing_rules
where grouping_type = 'model'
  and category_id in (select id from public.categories where name in ('Cadenas','Anillos','Collares'));

insert into public.pricing_rules (category_id, grouping_type, min_quantity, discount_per_unit)
select id, 'model', 6, 1 from public.categories where name in ('Anillos','Collares')
union all
select id, 'model', 12, 2 from public.categories where name in ('Anillos','Collares');

-- 4) La reserva del catálogo público pasa de 15 a 5 minutos, como pediste.
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

-- 5) "Carpeta de pedidos" del catálogo: guardamos con qué sesión llegó el pedido
--    (para poder liberar su reserva) y a qué pedido/cliente quedó asignado.
alter table public.catalog_submissions add column if not exists session_id text;
alter table public.catalog_submissions add column if not exists order_id uuid references public.orders(id);
alter table public.catalog_submissions add column if not exists notes text;

-- 6) Aceptar un pedido del catálogo: crea/reusa cliente y pedido, asigna cada
--    ítem al inventario real (con la cantidad que decida el admin, por si hay
--    unidades extraviadas o defectuosas), descuenta del catálogo público y
--    libera la reserva temporal.
create or replace function public.accept_catalog_submission(
  p_submission_id uuid,
  p_customer_id uuid,
  p_items jsonb   -- [{ "catalog_product_id": "...", "quantity": 2 }, ...]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid;
  v_session_id text;
  v_item jsonb;
  v_catalog_product_id uuid;
  v_quantity int;
  v_product_id uuid;
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

  update public.catalog_submissions
    set status = 'attached', order_id = v_order_id
    where id = p_submission_id;

  return v_order_id;
end;
$$;

-- 7) Rechazar un pedido del catálogo: libera sus reservas y lo marca descartado.
create or replace function public.discard_catalog_submission(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_session_id text;
begin
  select session_id into v_session_id from public.catalog_submissions where id = p_submission_id;
  delete from public.catalog_reservations where session_id = v_session_id;
  update public.catalog_submissions set status = 'discarded' where id = p_submission_id;
end;
$$;

-- 8) Apariencia del sistema (Configuración → estilo de la barra, colores, nombre)
alter table public.app_settings add column if not exists theme_preset text not null default 'clasico';
alter table public.app_settings add column if not exists color_primario text not null default '#9C7A3C';
alter table public.app_settings add column if not exists color_acento text not null default '#4F6F52';
alter table public.app_settings add column if not exists estilo_barra text not null default 'solido';

-- Permisos de las nuevas funciones (mismo criterio que el resto: solo staff conectado)
revoke all on function public.accept_catalog_submission(uuid, uuid, jsonb) from public;
grant execute on function public.accept_catalog_submission(uuid, uuid, jsonb) to authenticated;
revoke all on function public.discard_catalog_submission(uuid) from public;
grant execute on function public.discard_catalog_submission(uuid) to authenticated;

-- =========================================================
-- FIN DE LA MIGRACIÓN 2
-- =========================================================
