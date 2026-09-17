import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. Configúralas en Netlify o en tu archivo .env"
  );
}

// Cliente normal: se usa para todo el software (mantiene la sesión activa).
export const supabase = createClient(url, anonKey);

// Segundo cliente: solo para crear usuarios nuevos (empleados) desde Configuración.
// No guarda sesión, así que crear un empleado nunca cierra la sesión del administrador.
export const supabaseSignUpClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
