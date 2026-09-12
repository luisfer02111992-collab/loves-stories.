import { supabase } from "./supabase";

// Sube una imagen al bucket público "imagenes" (creado en supabase_migration_2.sql)
// y devuelve la URL pública lista para guardar en products.image_url o catalog_products.image_url.
export async function subirImagen(file: File, carpeta: string): Promise<string | null> {
  const ext = file.name.split(".").pop() || "jpg";
  const ruta = `${carpeta}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("imagenes").upload(ruta, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) {
    alert(`No se pudo subir la imagen: ${error.message}`);
    return null;
  }
  const { data } = supabase.storage.from("imagenes").getPublicUrl(ruta);
  return data.publicUrl;
}
