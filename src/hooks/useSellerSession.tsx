import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Seller } from "../lib/types";

interface SellerSessionState {
  vendedores: Seller[];
  vendedorActivoId: string | null;
  sesionActivaId: string | null;
  vendedorActivoNombre: string | null;
  iniciarSesion: (sellerId: string) => Promise<void>;
  finalizarSesion: () => Promise<void>;
  recargarVendedores: () => Promise<void>;
}

const SellerSessionContext = createContext<SellerSessionState>({
  vendedores: [],
  vendedorActivoId: null,
  sesionActivaId: null,
  vendedorActivoNombre: null,
  iniciarSesion: async () => {},
  finalizarSesion: async () => {},
  recargarVendedores: async () => {},
});

const LS_SESSION = "ls_sesion_activa";
const LS_SELLER = "ls_vendedor_activo";

export function SellerSessionProvider({ children }: { children: React.ReactNode }) {
  const [vendedores, setVendedores] = useState<Seller[]>([]);
  const [sesionActivaId, setSesionActivaId] = useState<string | null>(() => localStorage.getItem(LS_SESSION));
  const [vendedorActivoId, setVendedorActivoId] = useState<string | null>(() => localStorage.getItem(LS_SELLER));

  useEffect(() => {
    recargarVendedores();
  }, []);

  async function recargarVendedores() {
    const { data } = await supabase.from("sellers").select("*").order("name");
    setVendedores((data as Seller[]) ?? []);
  }

  async function iniciarSesion(sellerId: string) {
    const { data, error } = await supabase.rpc("iniciar_sesion_vendedor", { p_seller_id: sellerId });
    if (error) {
      alert(error.message);
      return;
    }
    setSesionActivaId(data as string);
    setVendedorActivoId(sellerId);
    localStorage.setItem(LS_SESSION, data as string);
    localStorage.setItem(LS_SELLER, sellerId);
  }

  async function finalizarSesion() {
    if (sesionActivaId) {
      await supabase.rpc("finalizar_sesion_vendedor", { p_session_id: sesionActivaId });
    }
    setSesionActivaId(null);
    setVendedorActivoId(null);
    localStorage.removeItem(LS_SESSION);
    localStorage.removeItem(LS_SELLER);
  }

  const vendedorActivoNombre = vendedores.find((v) => v.id === vendedorActivoId)?.name ?? null;

  return (
    <SellerSessionContext.Provider value={{ vendedores, vendedorActivoId, sesionActivaId, vendedorActivoNombre, iniciarSesion, finalizarSesion, recargarVendedores }}>
      {children}
    </SellerSessionContext.Provider>
  );
}

export function useSellerSession() {
  return useContext(SellerSessionContext);
}
