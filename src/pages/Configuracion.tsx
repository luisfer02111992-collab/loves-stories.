import React, { useEffect, useState } from "react";
import { Pencil, MessageCircle, Palette } from "lucide-react";
import { supabase, supabaseSignUpClient } from "../lib/supabase";
import type { Profile } from "../lib/types";

const PRESETS = [
  { key: "clasico", label: "Clásico dorado", primario: "#9C7A3C", acento: "#4F6F52" },
  { key: "rosa", label: "Rosa pastel", primario: "#B76E79", acento: "#8C6E63" },
  { key: "salvia", label: "Verde salvia", primario: "#4F6F52", acento: "#9C7A3C" },
  { key: "vino", label: "Vino elegante", primario: "#7A2540", acento: "#B7791F" },
];

const ESTILOS_BARRA = [
  { key: "solido", label: "Sólido oscuro" },
  { key: "degradado", label: "Degradado con tu color" },
  { key: "claro", label: "Claro" },
];

export default function Configuracion() {
  const [nombrePagina, setNombrePagina] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [conectado, setConectado] = useState<string | null>(null);
  const [editandoNumero, setEditandoNumero] = useState(false);
  const [usuarios, setUsuarios] = useState<Profile[]>([]);
  const [sesiones, setSesiones] = useState<{ full_name: string; device: string; logged_in_at: string }[]>([]);
  const [themePreset, setThemePreset] = useState("clasico");
  const [colorPrimario, setColorPrimario] = useState("#9C7A3C");
  const [colorAcento, setColorAcento] = useState("#4F6F52");
  const [estiloBarra, setEstiloBarra] = useState("solido");

  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoCorreo, setNuevoCorreo] = useState("");
  const [nuevaClave, setNuevaClave] = useState("");
  const [nuevoRol, setNuevoRol] = useState<"employee" | "admin">("employee");
  const [creando, setCreando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data: settings } = await supabase.from("app_settings").select("*").eq("id", 1).single();
    if (settings) {
      setNombrePagina(settings.business_name);
      setWhatsapp(settings.whatsapp_number ?? "");
      setConectado(settings.whatsapp_number ?? null);
      setThemePreset(settings.theme_preset ?? "clasico");
      setColorPrimario(settings.color_primario ?? "#9C7A3C");
      setColorAcento(settings.color_acento ?? "#4F6F52");
      setEstiloBarra(settings.estilo_barra ?? "solido");
    }
    const { data: perfiles } = await supabase.from("profiles").select("*").order("created_at");
    setUsuarios((perfiles as Profile[]) ?? []);
    const { data: log } = await supabase
      .from("login_log")
      .select("device, logged_in_at, profiles(full_name)")
      .order("logged_in_at", { ascending: false })
      .limit(10);
    setSesiones((log ?? []).map((l: any) => ({ full_name: l.profiles?.full_name ?? "Usuario", device: l.device, logged_in_at: l.logged_in_at })));
  }

  async function guardarNombre() {
    await supabase.from("app_settings").update({ business_name: nombrePagina, updated_at: new Date().toISOString() }).eq("id", 1);
  }

  async function aplicarPreset(preset: typeof PRESETS[number]) {
    setThemePreset(preset.key);
    setColorPrimario(preset.primario);
    setColorAcento(preset.acento);
    await supabase.from("app_settings").update({
      theme_preset: preset.key, color_primario: preset.primario, color_acento: preset.acento, updated_at: new Date().toISOString(),
    }).eq("id", 1);
  }

  async function guardarColoresPersonalizados() {
    await supabase.from("app_settings").update({
      theme_preset: "personalizado", color_primario: colorPrimario, color_acento: colorAcento, updated_at: new Date().toISOString(),
    }).eq("id", 1);
    setThemePreset("personalizado");
  }

  async function guardarEstiloBarra(estilo: string) {
    setEstiloBarra(estilo);
    await supabase.from("app_settings").update({ estilo_barra: estilo, updated_at: new Date().toISOString() }).eq("id", 1);
  }

  async function conectarWhatsapp() {
    await supabase.from("app_settings").update({ whatsapp_number: whatsapp }).eq("id", 1);
    setConectado(whatsapp);
    setEditandoNumero(false);
  }
  async function desconectarWhatsapp() {
    await supabase.from("app_settings").update({ whatsapp_number: null }).eq("id", 1);
    setConectado(null);
    setWhatsapp("");
    setEditandoNumero(true);
  }

  async function crearUsuario(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    setCreando(true);
    const { data, error } = await supabaseSignUpClient.auth.signUp({
      email: nuevoCorreo,
      password: nuevaClave,
      options: { data: { full_name: nuevoNombre } },
    });
    if (error) {
      setMensaje(error.message);
      setCreando(false);
      return;
    }
    if (data.user) {
      // El trigger de la base de datos ya creó el perfil con rol "employee";
      // aquí solo ajustamos nombre y rol si el administrador eligió "admin".
      await supabase.from("profiles").update({ full_name: nuevoNombre, role: nuevoRol }).eq("id", data.user.id);
    }
    setMensaje("Usuario creado. Si tu proyecto pide confirmar el correo, la persona debe revisar su bandeja de entrada antes de poder ingresar.");
    setNuevoNombre(""); setNuevoCorreo(""); setNuevaClave(""); setNuevoRol("employee");
    setCreando(false);
    cargar();
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <p className="font-serif text-lg mb-3">Nombre de la página</p>
        <div className="p-4 mb-5 flex items-center gap-3" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <Pencil size={15} style={{ color: "#5B4E5E" }} />
          <input value={nombrePagina} onChange={(e) => setNombrePagina(e.target.value)} className="flex-1 px-3 py-2 rounded text-sm outline-none font-cursive" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2", fontSize: "1.1rem" }} />
          <button onClick={guardarNombre} className="text-xs px-3 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Guardar</button>
        </div>

        <p className="font-serif text-lg mb-3 flex items-center gap-2"><Palette size={16} style={{ color: "#5B4E5E" }} /> Apariencia del sistema</p>
        <div className="p-4 mb-5" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Estilos de diseño</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => aplicarPreset(p)}
                className="p-2.5 rounded-md text-left"
                style={{ background: themePreset === p.key ? "#EDE7DE" : "#F7F3EC", border: themePreset === p.key ? `2px solid ${p.primario}` : "1px solid #D9D0C2" }}>
                <div className="flex gap-1 mb-1.5">
                  <span className="w-4 h-4 rounded-full" style={{ background: p.primario }} />
                  <span className="w-4 h-4 rounded-full" style={{ background: p.acento }} />
                </div>
                <p className="text-xs">{p.label}</p>
              </button>
            ))}
          </div>

          <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>O elige tus propios colores</p>
          <div className="flex items-end gap-3 mb-4">
            <div>
              <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Color principal</p>
              <input type="color" value={colorPrimario} onChange={(e) => setColorPrimario(e.target.value)} className="w-12 h-9 rounded cursor-pointer" style={{ border: "1px solid #D9D0C2" }} />
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: "#5B4E5E" }}>Color de acento</p>
              <input type="color" value={colorAcento} onChange={(e) => setColorAcento(e.target.value)} className="w-12 h-9 rounded cursor-pointer" style={{ border: "1px solid #D9D0C2" }} />
            </div>
            <button onClick={guardarColoresPersonalizados} className="text-xs px-3 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>Guardar colores</button>
          </div>

          <p className="text-xs mb-2" style={{ color: "#5B4E5E" }}>Estilo de la barra de herramientas</p>
          <div className="flex gap-2">
            {ESTILOS_BARRA.map((e) => (
              <button key={e.key} onClick={() => guardarEstiloBarra(e.key)} className="text-xs px-3 py-1.5 rounded-md"
                style={{ background: estiloBarra === e.key ? "#9C7A3C" : "#EDE7DE", color: estiloBarra === e.key ? "#F7F3EC" : "#2B1E2E", border: "1px solid #D9D0C2" }}>
                {e.label}
              </button>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: "#5B4E5E" }}>Los cambios se ven al instante en la barra lateral y la parte superior.</p>
        </div>

        <p className="font-serif text-lg mb-3">Número de WhatsApp conectado</p>
        <div className="p-4 mb-5" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {conectado && !editandoNumero ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#4F6F52" }} />
                <div>
                  <p className="text-sm">{conectado}</p>
                  <p className="text-xs" style={{ color: "#5B4E5E" }}>Guardado — los botones "Enviar por WhatsApp" abren el chat listo desde este número; tú confirmas el envío.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditandoNumero(true)} className="text-xs px-3 py-2 rounded-md" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>Cambiar número</button>
                <button onClick={desconectarWhatsapp} className="text-xs px-3 py-2 rounded-md" style={{ background: "#F4E3E6", color: "#7A2540" }}>Desconectar</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+591 7XXXXXXX" className="flex-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
              <button onClick={conectarWhatsapp} disabled={!whatsapp} className="text-xs px-4 py-2 rounded-md flex items-center gap-1.5" style={{ background: whatsapp ? "#4F6F52" : "#D9D0C2", color: "#F7F3EC" }}>
                <MessageCircle size={13} /> Conectar
              </button>
            </div>
          )}
        </div>

        <p className="font-serif text-lg mb-3">Usuarios del sistema</p>
        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {usuarios.map((u, i) => (
            <div key={u.id} className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: i < usuarios.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <p className="text-sm">{u.full_name || "(sin nombre)"}</p>
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: u.role === "admin" ? "#F6EAD2" : "#E4EBE1", color: u.role === "admin" ? "#7A5F2D" : "#4F6F52" }}>
                {u.role === "admin" ? "Administrador" : "Vendedor"}
              </span>
            </div>
          ))}
        </div>

        <p className="font-serif text-lg mb-3 mt-5">Sesiones recientes</p>
        <div style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
          {sesiones.map((s, i) => (
            <div key={i} className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: i < sesiones.length - 1 ? "1px solid #D9D0C2" : "none" }}>
              <span className="text-sm">{s.full_name}</span>
              <span className="text-xs" style={{ color: "#5B4E5E" }}>{s.device} · {new Date(s.logged_in_at).toLocaleString("es-BO")}</span>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={crearUsuario} className="p-4 h-fit" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
        <p className="font-serif text-base mb-3">Crear usuario</p>
        <label className="text-xs" style={{ color: "#5B4E5E" }}>Nombre</label>
        <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} required className="w-full mb-2 mt-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
        <label className="text-xs" style={{ color: "#5B4E5E" }}>Correo</label>
        <input value={nuevoCorreo} onChange={(e) => setNuevoCorreo(e.target.value)} type="email" required className="w-full mb-2 mt-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
        <label className="text-xs" style={{ color: "#5B4E5E" }}>Contraseña</label>
        <input value={nuevaClave} onChange={(e) => setNuevaClave(e.target.value)} type="password" required minLength={6} className="w-full mb-2 mt-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
        <label className="text-xs" style={{ color: "#5B4E5E" }}>Rol</label>
        <select value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value as "employee" | "admin")} className="w-full mb-3 mt-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
          <option value="employee">Vendedor</option>
          <option value="admin">Administrador</option>
        </select>
        {mensaje && <p className="text-xs mb-2" style={{ color: "#7A5F2D" }}>{mensaje}</p>}
        <button type="submit" disabled={creando} className="w-full py-2 rounded-md text-sm" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
          {creando ? "Creando..." : "Crear usuario"}
        </button>
      </form>
    </div>
  );
}
