# Loves Stories — sistema interno

Aplicación en React + Vite + TypeScript, conectada a Supabase, lista para publicar en Netlify.

## 1. Crear la base de datos en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo.
2. Ve a **SQL Editor → New query**.
3. Abre el archivo `supabase_schema.sql` (incluido junto a este ZIP), copia todo su contenido y pégalo ahí.
4. Presiona **Run**. Esto crea todas las tablas, la seguridad y las funciones — una sola vez.

## 2. Crear tu usuario administrador

Supabase no permite crear usuarios con contraseña desde el SQL Editor (por seguridad), así que este paso es aparte:

1. En Supabase, ve a **Authentication → Users → Add user**.
2. Escribe tu correo y la contraseña que quieras usar. Guarda.
3. Vuelve a **SQL Editor**, pega esto (cambia el correo por el tuyo) y presiona Run:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'tu_correo@ejemplo.com');
   ```
4. Listo — ese usuario ya puede entrar al software como Administrador. Cualquier otro usuario (empleados) lo creas después desde **Configuración → Crear usuario**, dentro del propio software.

   Nota: si tu proyecto de Supabase pide "confirmar correo" para nuevas cuentas (viene activado por defecto), la persona que crees deberá revisar su correo antes de poder ingresar. Si prefieres que puedan entrar de inmediato, puedes desactivar esa confirmación en **Authentication → Providers → Email → Confirm email**.

## 3. Crear el bucket de imágenes

1. Ve a **Storage → New bucket**.
2. Nómbralo exactamente: `product-images`
3. Márcalo como **Public**.
4. Guarda. (No necesitas crear nada más en Storage.)

## 4. Conectar el software con tu proyecto

1. En Supabase, ve a **Project Settings → API**.
2. Copia el **Project URL** y la **anon / publishable key**.
3. En este proyecto, crea un archivo llamado `.env` (puedes copiar `.env.example` y renombrarlo) con:
   ```
   VITE_SUPABASE_URL=el_project_url_que_copiaste
   VITE_SUPABASE_ANON_KEY=la_clave_anon_que_copiaste
   ```

## 5. Publicar en Netlify

1. Sube esta carpeta a un repositorio de GitHub (o arrastra el ZIP directo si usas "Deploy manually" en Netlify).
2. En Netlify: **Add new site → Import an existing project**, elige el repositorio.
3. Netlify va a detectar automáticamente `npm run build` y la carpeta `dist` (ya viene configurado en `netlify.toml`).
4. Antes de publicar, ve a **Site configuration → Environment variables** y agrega las mismas dos variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Publica el sitio (Deploy site).

## Resumen rápido

- [ ] Pegar `supabase_schema.sql` en el SQL Editor de Supabase (una vez)
- [ ] Crear tu usuario en Authentication → Add user, y ejecutar el UPDATE para volverlo admin
- [ ] Crear el bucket `product-images` (público) en Storage
- [ ] Copiar Project URL y anon key a `.env` (o a las variables de entorno de Netlify)
- [ ] Publicar en Netlify

## Qué está conectado de verdad a Supabase en esta primera versión

Auth y roles, Clientes, Productos (con historial de precios), Inventario (con carga por Excel y aviso de códigos repetidos), Compras, Asignación rápida y a varios clientes (con función segura que nunca deja el stock en negativo), Catálogo público con reservas temporales de 15 minutos, Depósitos, Reportes (ventas, ganancia, valor de inventario, gráfico), Papelera, Configuración (nombre de página, número de WhatsApp, usuarios, sesiones).

Dos cosas quedan como maqueta a propósito, para no salirse del stack simple que definiste:
- **Búsqueda de producto por foto**: la pantalla ya está en Asignación rápida, pero no hay ningún servicio de reconocimiento de imágenes conectado todavía (eso requeriría una integración externa).
- **PDF del recibo**: se genera usando la función de impresión del navegador (el recibo térmico 8x8 cm ya tiene su propio estilo de impresión) — desde ahí puedes elegir "Guardar como PDF" y enviarlo por WhatsApp manualmente.
