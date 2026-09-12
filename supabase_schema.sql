-- =========================================================
-- LOVES STORIES — ESQUEMA COMPLETO DE SUPABASE
-- Pega este archivo completo, una sola vez, en:
-- Supabase → SQL Editor → New query → pega todo → Run
-- =========================================================

create extension if not exists pgcrypto;

-- =========================================================
-- 1. PERFILES DE USUARIO (administrador / vendedor)
-- =========================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'employee' check (role in ('admin','employee')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cuando se crea un usuario nuevo en Supabase Auth, se crea su perfil automáticamente
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), 'employee');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;

create function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

-- =========================================================
-- 2. CONFIGURACIÓN GENERAL (nombre de página, WhatsApp)
-- =========================================================
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Loves Stories',
  whatsapp_number text,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id, business_name) values (1, 'Loves Stories');

-- =========================================================
-- 3. CATEGORÍAS
-- =========================================================
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);
insert into public.categories (name, sort_order) values
  ('Aretes',1), ('Dijes',2), ('Sets',3), ('Pulseras',4),
  ('Anillos',5), ('Collares',6), ('Cadenas',7), ('Otros',8);

-- =========================================================
-- 4. COMPRAS / LOTES CARGADOS
-- =========================================================
create table public.purchase_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,                     -- ej. "Lote 1"
  source text not null default 'excel' check (source in ('excel','manual')),
  total_detected int not null default 0,
  total_ok int not null default 0,
  total_errors int not null default 0,
  original_data jsonb,                     -- copia del inventario tal como se cargó (para cruce de datos)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- =========================================================
-- 5. PRODUCTOS (inventario maestro, sin fotos)
-- =========================================================
create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  barcode text,
  name text not null,
  description text,
  category_id uuid references public.categories(id),
  cost numeric(10,2) not null default 0,
  price numeric(10,2) not null default 0,
  stock_physical int not null default 0 check (stock_physical >= 0),
  stock_reserved int not null default 0 check (stock_reserved >= 0),
  stock_available int generated always as (stock_physical - stock_reserved) stored,
  batch_id uuid references public.purchase_batches(id),
  active boolean not null default true,
  deleted_at timestamptz,                  -- papelera (borrado suave)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_products_code on public.products(code);
create index idx_products_barcode on public.products(barcode);
create index idx_products_batch on public.products(batch_id);

-- Historial de precios (no se pierde el precio anterior)
create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(10,2) not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,                    -- null = vigente
  changed_by uuid references public.profiles(id)
);

-- Reglas de precio configurables (motor de precios)
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id),   -- null = aplica a todas
  grouping_type text not null check (grouping_type in ('category','model')),
  min_quantity int not null,
  discount_per_unit numeric(10,2) not null default 0,
  active boolean not null default true
);
insert into public.pricing_rules (category_id, grouping_type, min_quantity, discount_per_unit)
select id, 'category', 3, 1 from public.categories where name in ('Aretes','Dijes','Sets','Pulseras')
union all
select id, 'category', 6, 2 from public.categories where name in ('Aretes','Dijes','Sets','Pulseras')
union all
select id, 'model', 6, 1 from public.categories where name in ('Anillos','Cadenas')
union all
select id, 'model', 12, 2 from public.categories where name in ('Anillos','Cadenas');

-- =========================================================
-- 6. CLIENTES
-- =========================================================
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  notes text,
  status text not null default 'active',
  deleted_at timestamptz,                  -- papelera
  created_at timestamptz not null default now()
);
create index idx_customers_phone on public.customers(phone);

-- =========================================================
-- 7. PEDIDOS
-- =========================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigserial unique,
  customer_id uuid not null references public.customers(id),
  status text not null default 'open' check (status in ('open','closed','reopened','cancelled')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid references public.profiles(id)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null,
  origin text not null default 'manual' check (origin in ('manual','catalogo','live','correccion','otro')),
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now()
);

-- Historial inalterable: cada +/- queda registrado, nunca se borra
create table public.order_item_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  product_id uuid not null references public.products(id),
  quantity_delta int not null,
  unit_price numeric(10,2),
  origin text,
  performed_by uuid references public.profiles(id),
  performed_at timestamptz not null default now()
);

create table public.pdf_versions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  version int not null,
  snapshot jsonb not null,                 -- copia congelada del pedido en ese momento
  generated_by uuid references public.profiles(id),
  generated_at timestamptz not null default now()
);

-- =========================================================
-- 8. MOVIMIENTOS DE INVENTARIO (nunca se depende solo del número de stock)
-- =========================================================
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  type text not null check (type in
    ('entrada','asignacion','devolucion','venta','cancelacion','correccion','ajuste','importacion','merma')),
  quantity_delta int not null,
  reason text,                             -- para mermas: Dañado / Perdido / Robado / Otro
  order_id uuid references public.orders(id),
  performed_by uuid references public.profiles(id),
  performed_at timestamptz not null default now()
);

-- =========================================================
-- 9. DEPÓSITOS
-- =========================================================
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.orders(id),
  amount numeric(10,2) not null check (amount > 0),
  method text not null default 'efectivo',
  reference text,
  notes text,
  registered_by uuid references public.profiles(id),
  paid_at timestamptz not null default now()
);

-- =========================================================
-- 10. CATÁLOGO PÚBLICO (independiente del inventario maestro)
-- =========================================================
create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),   -- vínculo opcional al maestro
  code text not null,
  name text not null,
  price numeric(10,2) not null,
  image_url text,
  stock_available int not null default 0 check (stock_available >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.catalog_reservations (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.catalog_products(id) on delete cascade,
  session_id text not null,                -- identificador anónimo del navegador del cliente
  quantity int not null check (quantity > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index idx_reservations_product on public.catalog_reservations(catalog_product_id);
create index idx_reservations_expira on public.catalog_reservations(expires_at);

create table public.catalog_submissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,               -- ej. CAT-00128
  customer_name text not null,
  customer_phone text not null,
  status text not null default 'pending' check (status in ('pending','reviewed','attached','discarded')),
  created_at timestamptz not null default now()
);

create table public.catalog_submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.catalog_submissions(id) on delete cascade,
  catalog_product_id uuid not null references public.catalog_products(id),
  quantity int not null check (quantity > 0)
);

-- =========================================================
-- 11. AUDITORÍA (no se puede editar ni borrar)
-- =========================================================
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references public.profiles(id),
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- Registro de inicios de sesión
create table public.login_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  device text,
  logged_in_at timestamptz not null default now()
);

-- =========================================================
-- 12. FUNCIONES CLAVE (evitan stock negativo y carreras de datos)
-- =========================================================

-- Asignar un producto a un pedido de forma segura (nunca deja el stock en negativo)
create function public.assign_product_to_order(
  p_order_id uuid, p_product_id uuid, p_quantity int, p_origin text default 'manual'
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

  insert into public.order_items (order_id, product_id, quantity, unit_price, origin, assigned_by)
  values (p_order_id, p_product_id, p_quantity, v_price, p_origin, auth.uid());

  insert into public.order_item_history (order_id, product_id, quantity_delta, unit_price, origin, performed_by)
  values (p_order_id, p_product_id, p_quantity, v_price, p_origin, auth.uid());

  insert into public.inventory_movements (product_id, type, quantity_delta, order_id, performed_by)
  values (p_product_id, 'asignacion', -p_quantity, p_order_id, auth.uid());
end;
$$;

-- Quitar una unidad de un pedido (la unidad regresa al inventario, con historial)
create function public.remove_order_item_unit(p_order_item_id uuid, p_quantity int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid; v_product_id uuid; v_price numeric(10,2);
begin
  select order_id, product_id, unit_price into v_order_id, v_product_id, v_price
  from public.order_items where id = p_order_item_id for update;

  update public.order_items set quantity = quantity - p_quantity where id = p_order_item_id;
  delete from public.order_items where id = p_order_item_id and quantity <= 0;

  update public.products set stock_reserved = greatest(0, stock_reserved - p_quantity), updated_at = now()
  where id = v_product_id;

  insert into public.order_item_history (order_id, product_id, quantity_delta, unit_price, origin, performed_by)
  values (v_order_id, v_product_id, -p_quantity, v_price, 'correccion', auth.uid());

  insert into public.inventory_movements (product_id, type, quantity_delta, order_id, performed_by)
  values (v_product_id, 'devolucion', p_quantity, v_order_id, auth.uid());
end;
$$;

-- Cerrar un pedido
create function public.close_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'closed', closed_at = now() where id = p_order_id;
  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'pedido_cerrado', jsonb_build_object('order_id', p_order_id));
end;
$$;

-- Reabrir un pedido
create function public.reopen_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'reopened', closed_at = null where id = p_order_id;
  insert into public.audit_log (actor, action, details)
  values (auth.uid(), 'pedido_reabierto', jsonb_build_object('order_id', p_order_id));
end;
$$;

-- Registrar una merma (descuenta del físico, no del reservado)
create function public.registrar_merma(p_product_id uuid, p_quantity int, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.products set stock_physical = stock_physical - p_quantity, updated_at = now()
  where id = p_product_id and stock_physical >= p_quantity;

  if not found then
    raise exception 'No hay suficiente stock físico para registrar esta merma';
  end if;

  insert into public.inventory_movements (product_id, type, quantity_delta, reason, performed_by)
  values (p_product_id, 'merma', -p_quantity, p_motivo, auth.uid());
end;
$$;

-- Reserva temporal en el catálogo público (15 minutos), segura ante concurrencia
create function public.catalog_reserve(p_catalog_product_id uuid, p_session_id text, p_quantity int)
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
  values (p_catalog_product_id, p_session_id, p_quantity, now() + interval '15 minutes');

  return true;
end;
$$;

-- Limpiar reservas vencidas (se puede llamar desde el propio catálogo al cargar la página)
create function public.catalog_release_expired() returns void
language sql security definer set search_path = public as $$
  delete from public.catalog_reservations where expires_at < now();
$$;

-- =========================================================
-- 13. SEGURIDAD (RLS) — activar en todas las tablas
-- =========================================================
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.categories enable row level security;
alter table public.purchase_batches enable row level security;
alter table public.products enable row level security;
alter table public.price_history enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_history enable row level security;
alter table public.pdf_versions enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.payments enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_reservations enable row level security;
alter table public.catalog_submissions enable row level security;
alter table public.catalog_submission_items enable row level security;
alter table public.audit_log enable row level security;
alter table public.login_log enable row level security;

-- PROFILES: cada quien ve su perfil; el staff puede ver todos; solo admin modifica roles
create policy "profiles_select_staff" on public.profiles for select using (public.is_staff());
create policy "profiles_update_admin" on public.profiles for update using (public.is_admin());

-- APP_SETTINGS: lectura pública (para mostrar el nombre/logo en catálogo), edición solo admin
create policy "settings_select_public" on public.app_settings for select using (true);
create policy "settings_update_admin" on public.app_settings for update using (public.is_admin());

-- Tablas operativas: el staff activo (admin o vendedor) puede trabajar con normalidad
create policy "categories_all_staff" on public.categories for all using (public.is_staff()) with check (public.is_staff());
create policy "products_all_staff" on public.products for all using (public.is_staff()) with check (public.is_staff());
create policy "price_history_all_staff" on public.price_history for all using (public.is_staff()) with check (public.is_staff());
create policy "pricing_rules_select_staff" on public.pricing_rules for select using (public.is_staff());
create policy "pricing_rules_write_admin" on public.pricing_rules for insert with check (public.is_admin());
create policy "pricing_rules_update_admin" on public.pricing_rules for update using (public.is_admin());
create policy "customers_all_staff" on public.customers for all using (public.is_staff()) with check (public.is_staff());
create policy "orders_all_staff" on public.orders for all using (public.is_staff()) with check (public.is_staff());
create policy "order_items_all_staff" on public.order_items for all using (public.is_staff()) with check (public.is_staff());
create policy "order_item_history_select_staff" on public.order_item_history for select using (public.is_staff());
create policy "order_item_history_insert_staff" on public.order_item_history for insert with check (public.is_staff());
create policy "pdf_versions_all_staff" on public.pdf_versions for all using (public.is_staff()) with check (public.is_staff());
create policy "inventory_movements_select_staff" on public.inventory_movements for select using (public.is_staff());
create policy "inventory_movements_insert_staff" on public.inventory_movements for insert with check (public.is_staff());
create policy "payments_all_staff" on public.payments for all using (public.is_staff()) with check (public.is_staff());

-- Compras: solo administrador (el vendedor no debe ver esta sección)
create policy "purchase_batches_admin" on public.purchase_batches for all using (public.is_admin()) with check (public.is_admin());

-- CATÁLOGO PÚBLICO: cualquier visitante (sin iniciar sesión) puede ver lo activo
create policy "catalog_select_public" on public.catalog_products for select using (active = true or public.is_staff());
create policy "catalog_write_staff" on public.catalog_products for insert with check (public.is_staff());
create policy "catalog_update_staff" on public.catalog_products for update using (public.is_staff());
create policy "catalog_delete_staff" on public.catalog_products for delete using (public.is_staff());

-- Reservas temporales: el visitante puede crear/ver/borrar solo mediante las funciones RPC de arriba;
-- aquí solo dejamos lectura agregada necesaria para calcular disponibilidad en pantalla.
create policy "reservations_select_public" on public.catalog_reservations for select using (true);
create policy "reservations_staff_all" on public.catalog_reservations for all using (public.is_staff()) with check (public.is_staff());

-- Pedidos recibidos del catálogo: el público puede enviarlos, pero no leerlos después
create policy "submissions_insert_public" on public.catalog_submissions for insert with check (true);
create policy "submissions_select_staff" on public.catalog_submissions for select using (public.is_staff());
create policy "submissions_update_staff" on public.catalog_submissions for update using (public.is_staff());
create policy "submission_items_insert_public" on public.catalog_submission_items for insert with check (true);
create policy "submission_items_select_staff" on public.catalog_submission_items for select using (public.is_staff());

-- Auditoría: se puede insertar y leer, pero jamás editar ni borrar (no se crean políticas de update/delete)
create policy "audit_insert_staff" on public.audit_log for insert with check (public.is_staff());
create policy "audit_select_staff" on public.audit_log for select using (public.is_staff());

-- Sesiones
create policy "login_log_insert_staff" on public.login_log for insert with check (public.is_staff());
create policy "login_log_select_admin" on public.login_log for select using (public.is_admin());

-- =========================================================
-- FIN DEL SCRIPT — lo único que falta es crear tu usuario
-- administrador desde Authentication → Users → Add user,
-- y luego marcarlo como admin (ver instrucciones aparte).
-- =========================================================
