import React, { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard, Users, Tag, Boxes, Truck, ScanLine, Share2,
  ShoppingBag, BarChart3, Settings, LogOut, Send, Inbox, Receipt,
  UserCog, BadgePercent, UserCheck, History, Download, Calculator, Radio, PackageCheck,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useSellerSession } from "../hooks/useSellerSession";
import { supabase } from "../lib/supabase";
import { canAccess, type PermissionKey } from "../lib/permissions";
import { saveAutomaticBackup } from "../lib/backup";

const SECCIONES = [
  { permission: "asignar" as PermissionKey, to: "/", label: "Asignar / Vender", icon: ScanLine, roles: ["admin", "employee"] },
  { permission: "asignar" as PermissionKey, to: "/live", label: "Live", icon: Radio, roles: ["admin", "employee"] },
  { permission: "asignar" as PermissionKey, to: "/pedidos-live", label: "Pedidos Live", icon: PackageCheck, roles: ["admin", "employee"] },
  { permission: "resumen" as PermissionKey, to: "/resumen", label: "Resumen", icon: LayoutDashboard, roles: ["admin", "employee"] },
  { permission: "clientes" as PermissionKey, to: "/clientes", label: "Clientes", icon: Users, roles: ["admin", "employee"] },
  { permission: "reportes_dia" as PermissionKey, to: "/reportes-dia", label: "Reportes del día", icon: Send, roles: ["admin", "employee"] },
  { permission: "productos" as PermissionKey, to: "/productos", label: "Productos", icon: Tag, roles: ["admin", "employee"] },
  { permission: "inventario" as PermissionKey, to: "/inventario", label: "Inventario", icon: Boxes, roles: ["admin", "employee"] },
  { permission: "compras" as PermissionKey, to: "/compras", label: "Compras", icon: Truck, roles: ["admin"] },
  { permission: "asignacion_multiple" as PermissionKey, to: "/asignacion-multiple", label: "Asignar a varios", icon: Share2, roles: ["admin", "employee"] },
  { permission: "catalogo" as PermissionKey, to: "/catalogo", label: "Catálogo", icon: ShoppingBag, roles: ["admin", "employee"] },
  { permission: "pedidos_catalogo" as PermissionKey, to: "/pedidos-catalogo", label: "Pedidos del catálogo", icon: Inbox, roles: ["admin", "employee"] },
  { permission: "ventas" as PermissionKey, to: "/ventas", label: "Ventas", icon: Receipt, roles: ["admin", "employee"] },
  { permission: "historial_clientes" as PermissionKey, to: "/historial-clientes", label: "Historial clientes", icon: History, roles: ["admin", "employee"] },
  { permission: "cierre_caja" as PermissionKey, to: "/cierre-caja", label: "Cierre de caja", icon: Calculator, roles: ["admin"] },
  { permission: "reportes" as PermissionKey, to: "/reportes", label: "Reportes", icon: BarChart3, roles: ["admin"] },
  { permission: "vendedores" as PermissionKey, to: "/vendedores", label: "Vendedores", icon: UserCog, roles: ["admin"] },
  { permission: "reporte_vendedores" as PermissionKey, to: "/reporte-vendedores", label: "Reporte de vendedores", icon: BadgePercent, roles: ["admin"] },
  { permission: "configuracion" as PermissionKey, to: "/configuracion", label: "Configuración", icon: Settings, roles: ["admin"] },
];

export default function Layout() {
  const { profile, signOut } = useAuth();
  const { vendedores, vendedorActivoId, vendedorActivoNombre, iniciarSesion, finalizarSesion } = useSellerSession();
  const rol = profile?.role ?? "employee";
  const secciones = SECCIONES.filter((s) => s.roles.includes(rol) && canAccess(rol, profile?.permissions, s.permission));
  const [nombre, setNombre] = useState("Loves Stories");
  const [primario, setPrimario] = useState("#9C7A3C");
  const [estiloBarra, setEstiloBarra] = useState("solido");
  const [visualTheme, setVisualTheme] = useState("rosa_elegante");

async function cerrarSesionSeguro() {
  if (profile?.role === "admin") {
    try {
      await saveAutomaticBackup("cerrar_sesion");
    } catch (e) {
      console.error("No se pudo completar el respaldo al cerrar sesión:", e);
      alert("No se pudo guardar el respaldo. La sesión no se cerrará para evitar perder el respaldo.");
      return;
    }
  }

  await signOut();
}

  // En Android el zoom del navegador puede dejar el scroll horizontal sin recorrido.
  // Arrastre visual independiente: solo con un dedo y zoom activo.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".ls-app-shell");
    if (!shell) return;
    let startX = 0, startY = 0, originX = 0, shiftX = 0;
    let active = false, dragging = false;
    const isZoomed = () => (window.visualViewport?.scale ?? 1) > 1.05;
    const reset = () => {
      shiftX = 0;
      shell.style.transform = "";
      shell.style.willChange = "";
    };
    const start = (e: TouchEvent) => {
      active = false;
      dragging = false;
      if (e.touches.length !== 1 || !isZoomed()) return;
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,select,button,a,[contenteditable]")) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      originX = shiftX;
      active = true;
    };
    const move = (e: TouchEvent) => {
      if (!active || e.touches.length !== 1 || !isZoomed()) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)) { active = false; return; }
        if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        dragging = true;
      }
      // La traslación se limita para no perder la página fuera de pantalla.
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const pageWidth = Math.max(shell.scrollWidth, shell.getBoundingClientRect().width);
      const maxPan = Math.max(0, pageWidth - viewportWidth);
      shiftX = Math.min(0, Math.max(-maxPan, originX + dx));
      shell.style.willChange = "transform";
      shell.style.transform = `translate3d(${shiftX}px,0,0)`;
      e.preventDefault();
    };
    const end = () => { active = false; dragging = false; };
    const zoomChange = () => { if (!isZoomed()) reset(); };
    document.addEventListener("touchstart", start, { passive: true, capture: true });
    document.addEventListener("touchmove", move, { passive: false, capture: true });
    document.addEventListener("touchend", end, { passive: true, capture: true });
    document.addEventListener("touchcancel", end, { passive: true, capture: true });
    window.visualViewport?.addEventListener("resize", zoomChange);
    return () => {
      document.removeEventListener("touchstart", start, true);
      document.removeEventListener("touchmove", move, true);
      document.removeEventListener("touchend", end, true);
      document.removeEventListener("touchcancel", end, true);
      window.visualViewport?.removeEventListener("resize", zoomChange);
      reset();
    };
  }, []);

  useEffect(() => {
    cargarTema();
    const refrescarTema = () => cargarTema();
    window.addEventListener("loves-theme-changed", refrescarTema);
    return () => window.removeEventListener("loves-theme-changed", refrescarTema);
  }, []);

  async function cargarTema() {
    const { data } = await supabase.from("app_settings").select("*").eq("id", 1).single();
    if (data) {
      setNombre(data.business_name ?? "Loves Stories");
      setPrimario(data.color_primario ?? "#9C7A3C");
      setEstiloBarra(data.estilo_barra ?? "solido");
      const tema = data.visual_theme ?? "rosa_elegante";
      setVisualTheme(tema);
      document.documentElement.setAttribute("data-ls-theme", tema);
      document.documentElement.style.setProperty("--ls-primary", data.color_primario ?? "#9C7A3C");
      document.documentElement.style.setProperty("--ls-accent", data.color_acento ?? "#4F6F52");
    }
  }

  const temaVisual = visualTheme === "borgona_luxury"
    ? { shell: "#17050d", bar: "linear-gradient(180deg,#35091b 0%,#16040b 100%)", text: "#fff0f6", active: "#8f1747", activeText: "#fff7fb" }
    : visualTheme === "rosa_claro"
    ? { shell: "#fff7f9", bar: "linear-gradient(180deg,#fff5f7 0%,#f8dce5 100%)", text: "#681c36", active: "#f2bfd0", activeText: "#681c36" }
    : { shell: "#f8edf0", bar: "linear-gradient(180deg,#54263b 0%,#8d465f 100%)", text: "#fff3f7", active: "#f6e7eb", activeText: "#54263b" };

  const fondoBarra = visualTheme ? temaVisual.bar :
    estiloBarra === "degradado"
      ? `linear-gradient(135deg, #2B1E2E 0%, ${primario} 140%)`
      : estiloBarra === "claro"
      ? "#F7F3EC"
      : "#2B1E2E";
  const textoBarra = visualTheme ? temaVisual.text : (estiloBarra === "claro" ? "#2B1E2E" : "#C9BFC7");

  const menuRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  function navegarMenu(e: React.KeyboardEvent<HTMLAnchorElement>, actual: number) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const siguiente = Math.max(0, Math.min(secciones.length - 1, actual + (e.key === "ArrowDown" ? 1 : -1)));
    const enlace = menuRefs.current[secciones[siguiente].to];
    enlace?.focus({ preventScroll: true });
    enlace?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="min-h-screen flex flex-col ls-app-shell" style={{ background: temaVisual.shell, height: "100dvh", maxHeight: "100dvh", minHeight: 0, overflow: "hidden" }}>
      <div className="flex items-center justify-between px-4 py-2.5 gap-3 flex-wrap" style={{ background: fondoBarra }}>
        <div className="flex items-center gap-2"><img src="/loves-stories-logo.jpeg" alt="Logo Loves Stories" className="w-9 h-9 rounded-full object-cover border border-white/40"/><p className="font-cursive text-2xl" style={{ color: visualTheme === "rosa_claro" ? "#7b173b" : "#ffd3df" }}>{nombre}</p></div>

        <div className="flex items-center gap-2 text-xs" style={{ color: textoBarra }}>
          <UserCheck size={13} />
          {vendedorActivoId ? (
            <>
              <span>Vendedor actual: <strong>{vendedorActivoNombre}</strong></span>
              <button onClick={finalizarSesion} className="px-2.5 py-1 rounded-md" style={{ background: "#7A2540", color: "#F7F3EC" }}>
                Finalizar sesión
              </button>
            </>
          ) : (
            <select
              onChange={(e) => e.target.value && iniciarSesion(e.target.value)}
              value=""
              className="px-2 py-1 rounded-md text-xs"
              style={{ background: "#EDE7DE", color: "#2B1E2E", border: "1px solid #D9D0C2" }}
            >
              <option value="">Elegir vendedor actual…</option>
              {vendedores.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: textoBarra }}>
            {profile?.full_name || "Usuario"} · {rol === "admin" ? "Administrador" : "Empleado"}
          </span>
          <button onClick={cerrarSesionSeguro} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md" style={{ background: "#7A2540", color: "#F7F3EC" }}>
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row ls-workspace" style={{ height: 0, overflow: "hidden" }}>
        <div className="md:w-56 shrink-0 px-3 pt-3 pb-3 ls-sidebar" style={{ background: fondoBarra, display: "flex", flexDirection: "column", minHeight: 0, height: "100%", overflow: "hidden" }}>
          <div className="ls-sidebar-brand hidden md:block mb-3">
            <img src="/loves-stories-sidebar-brand.png" alt="LOVE'S STORIES Jewelry" />
          </div>
          <div className="flex md:flex-col gap-1 ls-sidebar-nav" style={{ flex: "1 1 0%", minHeight: 0, overflowY: "scroll", overflowX: "hidden", overscrollBehavior: "contain", scrollbarWidth: "auto" }}>
            {secciones.map((s, i) => {
              const Icon = s.icon;
              return (
                <NavLink
                  key={s.to}
                  ref={el => { menuRefs.current[s.to] = el; }}
                  onKeyDown={e => navegarMenu(e, i)}
                  to={s.to}
                  end={s.to === "/"}
                  className={({ isActive }) =>
                    "flex items-center gap-2 px-3 py-2 text-sm rounded-md whitespace-nowrap shrink-0 " +
                    (isActive ? "font-semibold" : "")
                  }
                  style={({ isActive }) => ({
                    background: isActive ? temaVisual.active : "transparent",
                    color: isActive ? temaVisual.activeText : textoBarra,
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

        <div className="p-5 flex-1 min-w-0 ls-main-content" style={{ height: "100%", minHeight: 0, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain" }}>
          <div className="ls-global-banner mb-5" aria-label="LOVE’S STORIES Jewelry">
            <img src="/loves-stories-banner.png" alt="LOVE’S STORIES Jewelry — Importamos sueños, entregamos emociones" />
          </div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
