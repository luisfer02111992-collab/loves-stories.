-- CORRECCIÓN 10: preferencias visuales de Reportes.
-- Incremental y segura: no elimina ni modifica ventas existentes.
alter table public.app_settings add column if not exists report_primary_color text not null default '#405B9B';
alter table public.app_settings add column if not exists report_secondary_color text not null default '#8AA05A';
notify pgrst, 'reload schema';
