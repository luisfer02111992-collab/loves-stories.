-- LOVES STORIES — CORRECCIÓN 21
-- Permisos por usuario. Ejecutar UNA sola vez en Supabase SQL Editor.
-- No borra ventas, clientes, productos, inventario ni configuraciones.

alter table public.profiles
  add column if not exists permissions text[];

-- Los usuarios existentes conservan el acceso operativo que tenían antes.
update public.profiles
set permissions = array[
  'asignar','resumen','clientes','reportes_dia','productos','inventario',
  'asignacion_multiple','catalogo','pedidos_catalogo','ventas','historial_clientes'
]::text[]
where role = 'employee' and permissions is null;

-- Admin no depende de esta lista: siempre tiene acceso completo en la aplicación.
update public.profiles set permissions = '{}'::text[] where role = 'admin' and permissions is null;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true
      and (role = 'admin' or p_permission = any(coalesce(permissions, '{}'::text[])))
  );
$$;

grant execute on function public.has_permission(text) to authenticated;
