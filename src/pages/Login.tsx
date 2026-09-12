import React, { useEffect, useState } from "react";
import { Lock, KeyRound } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [recuperar, setRecuperar] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [nombreNegocio, setNombreNegocio] = useState("Loves Stories");

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("business_name")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (data?.business_name) setNombreNegocio(data.business_name);
      });
  }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setCargando(false);
    if (error) setError("Usuario o contraseña incorrectos.");
  }

  async function recuperarClave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const correo = email.trim();
    if (!correo) {
      setError("Escribe tu correo antes de solicitar el enlace.");
      return;
    }

    setCargando(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(correo, {
      redirectTo: window.location.origin + "/restablecer-contrasena",
    });
    setCargando(false);

    if (err) {
      setError(err.message);
      return;
    }
    setEnviado(true);
  }

  if (recuperar) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink p-6" style={{ background: "#2B1E2E" }}>
        <div className="w-full max-w-sm rounded-md p-6" style={{ background: "#F7F3EC" }}>
          <p className="font-cursive text-3xl text-center mb-1" style={{ color: "#9C7A3C" }}>{nombreNegocio}</p>
          <p className="text-xs text-center mb-5 flex items-center justify-center gap-1.5" style={{ color: "#5B4E5E" }}>
            <KeyRound size={13} /> Recuperar contraseña
          </p>
          {enviado ? (
            <div className="text-center">
              <p className="text-sm mb-4">Te enviamos un enlace a tu correo.</p>
              <button onClick={() => { setRecuperar(false); setEnviado(false); setError(null); }} className="text-xs px-4 py-2 rounded-md" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                Volver al inicio de sesión
              </button>
            </div>
          ) : (
            <form onSubmit={recuperarClave}>
              <label className="text-xs" style={{ color: "#5B4E5E" }}>Tu correo</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
                className="w-full mb-2 mt-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />
              {error && <p className="text-xs mb-2" style={{ color: "#7A2540" }}>{error}</p>}
              <div className="flex gap-2 mt-2">
                <button type="submit" disabled={cargando} className="flex-1 py-2 rounded-md text-sm" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
                  {cargando ? "Enviando..." : "Enviar enlace"}
                </button>
                <button type="button" onClick={() => { setRecuperar(false); setError(null); }} className="flex-1 py-2 rounded-md text-sm" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>Cancelar</button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#2B1E2E" }}>
      <form onSubmit={entrar} className="w-full max-w-sm rounded-md p-6" style={{ background: "#F7F3EC" }}>
        <p className="font-cursive text-4xl text-center mb-1" style={{ color: "#9C7A3C" }}>{nombreNegocio}</p>
        <p className="text-xs text-center mb-5" style={{ color: "#5B4E5E" }}>Ingresa con tu usuario y contraseña</p>

        <label className="text-xs" style={{ color: "#5B4E5E" }}>Correo</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
          className="w-full mb-3 mt-1 px-3 py-2 rounded text-sm outline-none" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }} />

        <label className="text-xs" style={{ color: "#5B4E5E" }}>Contraseña</label>
        <div className="flex items-center gap-2 mb-2 mt-1 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
          <Lock size={13} style={{ color: "#5B4E5E" }} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required
            className="flex-1 text-sm outline-none bg-transparent" />
        </div>
        <button type="button" onClick={() => { setRecuperar(true); setError(null); }} className="text-xs mb-3" style={{ color: "#7A5F2D" }}>
          ¿Olvidaste tu contraseña?
        </button>

        {error && <p className="text-xs mb-3" style={{ color: "#7A2540" }}>{error}</p>}

        <button disabled={cargando} type="submit" className="w-full py-2.5 rounded-md text-sm" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
          {cargando ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
