import React, { useState } from "react";
import { KeyRound, Lock, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";

export default function ResetPassword() {
  const { signOut } = useAuth();
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exito, setExito] = useState(false);

  async function cambiarContrasena(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (nueva.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (nueva !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setCargando(true);
    const { error: err } = await supabase.auth.updateUser({ password: nueva });
    setCargando(false);

    if (err) {
      setError(err.message);
      return;
    }

    setExito(true);
    // Cerramos la sesión temporal de recuperación y mandamos a iniciar sesión con la clave nueva.
    setTimeout(() => {
      signOut();
    }, 2000);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#2B1E2E" }}>
      <div className="w-full max-w-sm rounded-md p-6" style={{ background: "#F7F3EC" }}>
        <p className="text-xs text-center mb-1 flex items-center justify-center gap-1.5" style={{ color: "#5B4E5E" }}>
          <KeyRound size={13} /> Restablecer contraseña
        </p>
        <p className="font-serif text-lg text-center mb-5">Elige tu nueva contraseña</p>

        {exito ? (
          <div className="text-center">
            <CheckCircle2 size={32} style={{ color: "#4F6F52" }} className="mx-auto mb-2" />
            <p className="text-sm mb-1">Tu contraseña se actualizó correctamente.</p>
            <p className="text-xs" style={{ color: "#5B4E5E" }}>Te llevamos al inicio de sesión…</p>
          </div>
        ) : (
          <form onSubmit={cambiarContrasena}>
            <label className="text-xs" style={{ color: "#5B4E5E" }}>Nueva contraseña</label>
            <div className="flex items-center gap-2 mb-3 mt-1 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
              <Lock size={13} style={{ color: "#5B4E5E" }} />
              <input value={nueva} onChange={(e) => setNueva(e.target.value)} type="password" required minLength={6}
                className="flex-1 text-sm outline-none bg-transparent" />
            </div>

            <label className="text-xs" style={{ color: "#5B4E5E" }}>Confirmar nueva contraseña</label>
            <div className="flex items-center gap-2 mb-3 mt-1 px-3 py-2 rounded" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
              <Lock size={13} style={{ color: "#5B4E5E" }} />
              <input value={confirmar} onChange={(e) => setConfirmar(e.target.value)} type="password" required minLength={6}
                className="flex-1 text-sm outline-none bg-transparent" />
            </div>

            {error && <p className="text-xs mb-3" style={{ color: "#7A2540" }}>{error}</p>}

            <button disabled={cargando} type="submit" className="w-full py-2.5 rounded-md text-sm" style={{ background: "#9C7A3C", color: "#F7F3EC" }}>
              {cargando ? "Cambiando..." : "Cambiar contraseña"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
