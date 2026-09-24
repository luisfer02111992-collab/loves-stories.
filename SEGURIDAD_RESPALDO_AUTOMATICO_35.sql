-- LOVE'S STORIES 1.1 - Corrección 35
-- Bucket PRIVADO para respaldos automáticos. Ejecutar UNA sola vez en Supabase SQL Editor.

insert into storage.buckets (id, name, public)
values ('respaldos', 'respaldos', false)
on conflict (id) do update set public = false;

drop policy if exists "respaldos_admin_select" on storage.objects;
create policy "respaldos_admin_select" on storage.objects
for select to authenticated
using (bucket_id = 'respaldos' and public.is_admin());

drop policy if exists "respaldos_admin_insert" on storage.objects;
create policy "respaldos_admin_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'respaldos' and public.is_admin());

drop policy if exists "respaldos_admin_delete" on storage.objects;
create policy "respaldos_admin_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'respaldos' and public.is_admin());
