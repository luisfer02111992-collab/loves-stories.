-- LOVE'S STORIES - Corrección 29
-- Añade la preferencia de los 3 temas visuales. No modifica datos operativos.
begin;
alter table public.app_settings
  add column if not exists visual_theme text default 'rosa_elegante';
update public.app_settings
set visual_theme = coalesce(nullif(visual_theme,''), 'rosa_elegante')
where id = 1;
commit;
