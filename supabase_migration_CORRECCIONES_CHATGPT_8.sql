-- LOVES STORIES — CORRECCIONES CHATGPT 8
-- Incremental. Ejecutar una sola vez después de CORRECCIONES_CHATGPT_7.sql.
-- Preferencia descriptiva de impresora térmica USB. La selección física la controla el navegador/Windows.
alter table public.app_settings add column if not exists thermal_printer_name text not null default '';
notify pgrst, 'reload schema';
