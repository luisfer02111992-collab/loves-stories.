import React, { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard, Users, Tag, Boxes, Truck, ScanLine, Share2,
  ShoppingBag, BarChart3, Settings, Trash2, LogOut, Send, Inbox, Receipt,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

const SECCIONES = [
  { to: "/", label: "Panel", icon: LayoutDashboard, roles: ["admin", "employee"] },
  { to: "/clientes", label: "Clientes", icon: Users, roles: ["admin", "employee"] },
  { to: "/reportes-dia", label: "Reportes del día", icon: Send, roles: ["admin", "employee"] },
  { to: "/productos", label: "Productos", icon: Tag, roles: ["admin", "employee"] },
  { to: "/inventario", label: "Inventario", icon: Boxes, roles: ["admin", "employee"] },
  { to: "/compras", label: "Compras", icon: Truck, roles: ["admin"] },
  { to: "/asignacion", label: "Asignación rápida", icon: ScanLine, roles: ["admin", "employee"] },
  { to: "/asignacion-multiple", label: "Asignar a varios", icon: Share2, roles: ["admin", "employee"] },
  { to: "/catalogo", label: "Catálogo", icon: ShoppingBag, roles: ["admin", "employee"] },
  { to: "/pedidos-catalogo", label: "Pedidos del catálogo", icon: Inbox, roles: ["admin", "employee"] },
  { to: "/ventas", label: "Ventas", icon: Receipt, roles: ["admin", "employee"] },
  { to: "/reportes", label: "Reportes", icon: BarChart3, roles: ["admin"] },
  { to: "/papelera", label: "Papelera", icon: Trash2, roles: ["admin"] },
  { to: "/configuracion", label: "Configuración", icon: Settings, roles: ["admin"] },
];

export default function Layout() {
  const { profile, signOut } = useAuth();
  const rol = profile?.role ?? "employee";
  const secciones = SECCIONES.filter((s) => s.roles.includes(rol));
  const [nombre, setNombre] = useState("Loves Stories");
  const [primario, setPrimario] = useState("#9C7A3C");
  const [estiloBarra, setEstiloBarra] = useState("solido");

  useEffect(() => {
    cargarTema();
  }, []);

  async function cargarTema() {
    const { data } = await supabase.from("app_settings").select("*").eq("id", 1).single();
    if (data) {
      setNombre(data.business_name ?? "Loves Stories");
      setPrimario(data.color_primario ?? "#9C7A3C");
      setEstiloBarra(data.estilo_barra ?? "solido");
      document.documentElement.style.setProperty("--ls-primary", data.color_primario ?? "#9C7A3C");
      document.documentElement.style.setProperty("--ls-accent", data.color_acento ?? "#4F6F52");
    }
  }

  const fondoBarra =
    estiloBarra === "degradado"
      ? `linear-gradient(135deg, #2B1E2E 0%, ${primario} 140%)`
      : estiloBarra === "claro"
      ? "#F7F3EC"
      : "#2B1E2E";
  const textoBarra = estiloBarra === "claro" ? "#2B1E2E" : "#C9BFC7";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#EDE7DE" }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: fondoBarra }}>
        <p className="font-cursive text-2xl" style={{ color: primario }}>{nombre}</p>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: textoBarra }}>
            {profile?.full_name || "Usuario"} · {rol === "admin" ? "Administrador" : "Vendedor"}
          </span>
          <button onClick={signOut} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md" style={{ background: "#7A2540", color: "#F7F3EC" }}>
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="md:w-52 shrink-0 px-3 pt-3 pb-3" style={{ background: fondoBarra }}>
          <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {secciones.map((s) => {
              const Icon = s.icon;
              return (
                <NavLink
                  key={s.to}
                  to={s.to}
                  end={s.to === "/"}
                  className={({ isActive }) =>
                    "flex items-center gap-2 px-3 py-2 text-sm rounded-md whitespace-nowrap shrink-0 " +
                    (isActive ? "font-semibold" : "")
                  }
                  style={({ isActive }) => ({
                    background: isActive ? "#EDE7DE" : "transparent",
                    color: isActive ? "#2B1E2E" : textoBarra,
                    borderRight: isActive ? `3px solid ${primario}` : "3px solid transparent",
                  })}
                >
                  <Icon size={15} />
                  {s.label}
                </NavLink>
              );
            })}
          </div>
        </div>

        <div className="p-5 flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
