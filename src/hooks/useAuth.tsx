import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

interface AuthState {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  recovery: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  userId: null,
  profile: null,
  recovery: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recovery, setRecovery] = useState(false);

  async function cargarPerfil(uid: string) {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile((data as Profile) ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id ?? null;
      setUserId(uid);
      if (uid) {
        cargarPerfil(uid).finally(() => setLoading(false));
        // Registro simple de la sesión (Configuración → Sesiones recientes)
        supabase.from("login_log").insert({
          user_id: uid,
          device: navigator.userAgent.includes("Mobile") ? "Celular" : "Computadora",
        });
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase dispara este evento cuando la sesión viene de un enlace de recuperación
      // de contraseña (el correo que envía resetPasswordForEmail). En ese caso no lo
      // tratamos como un inicio de sesión normal: mostramos la pantalla de nueva contraseña.
      if (event === "PASSWORD_RECOVERY") {
        setRecovery(true);
      }
      const uid = session?.user.id ?? null;
      setUserId(uid);
      if (uid) cargarPerfil(uid);
      else setProfile(null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

async function signOut() {
  setUserId(null);
  setProfile(null);
  setRecovery(false);

  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
  }
}

  return (
    <AuthContext.Provider value={{ loading, userId, profile, recovery, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
