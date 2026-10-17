import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { SellerSessionProvider } from "./hooks/useSellerSession";
import Layout from "./components/Layout";
import { canAccess, type PermissionKey } from "./lib/permissions";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const InicioVentas = lazy(() => import("./pages/InicioVentas"));
const Clientes = lazy(() => import("./pages/Clientes"));
const ReportesDelDia = lazy(() => import("./pages/ReportesDelDia"));
const Productos = lazy(() => import("./pages/Productos"));
const Inventario = lazy(() => import("./pages/Inventario"));
const Compras = lazy(() => import("./pages/Compras"));
const AsignacionMultiple = lazy(() => import("./pages/AsignacionMultiple"));
const Catalogo = lazy(() => import("./pages/Catalogo"));
const CatalogoPublico = lazy(() => import("./pages/CatalogoPublico"));
const Reportes = lazy(() => import("./pages/Reportes"));
const Configuracion = lazy(() => import("./pages/Configuracion"));
const PedidosCatalogo = lazy(() => import("./pages/PedidosCatalogo"));
const Ventas = lazy(() => import("./pages/Ventas"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Vendedores = lazy(() => import("./pages/Vendedores"));
const ReporteVendedores = lazy(() => import("./pages/ReporteVendedores"));
const CierreCaja = lazy(() => import("./pages/CierreCaja"));
const HistorialClientes = lazy(() => import("./pages/HistorialClientes"));
const Live = lazy(() => import("./pages/Live"));
const PedidosLive = lazy(() => import("./pages/PedidosLive"));

function Privado({ children }: { children: React.ReactNode }) {
  const { loading, userId } = useAuth();
  if (loading) return <div className="p-6 text-sm">Cargando…</div>;
  if (!userId) return <Navigate to="/login" replace />;
  return <>{children}</>;
}


function ConPermiso({ permiso, children }: { permiso: PermissionKey; children: React.ReactNode }) {
  const { profile } = useAuth();
  if (!profile) return null;
  if (!canAccess(profile.role, profile.permissions, permiso)) return <div className="p-6 text-sm">No tienes permiso para acceder a esta sección.</div>;
  return <>{children}</>;
}

function SoloAdmin({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  if (profile && profile.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SellerSessionProvider>
          <AppRoutes />
        </SellerSessionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function VistaClientes() {
  return <Clientes />;
}

function AppRoutes() {
  const { recovery } = useAuth();

  // El enlace de recuperación de Supabase puede caer en cualquier ruta de la app
  // (según la Site URL configurada en Supabase). En cuanto detectamos la sesión de
  // recuperación (evento PASSWORD_RECOVERY, ver useAuth), mostramos siempre la
  // pantalla de nueva contraseña, sin importar la ruta, hasta que el usuario la cambie.
  if (recovery) {
    return (
      <Suspense fallback={<div className="p-6 text-sm">Cargando sección…</div>}>
        <Routes>
          <Route path="*" element={<ResetPassword />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm">Cargando sección…</div>}>
    <Routes>
      {/* El catálogo público se ve sin iniciar sesión, con un link para compartir por WhatsApp */}
      <Route path="/catalogo-publico" element={<CatalogoPublico />} />
      <Route path="/login" element={<Login />} />
      <Route path="/restablecer-contrasena" element={<ResetPassword />} />

      <Route
        path="/"
        element={
          <Privado>
            <Layout />
          </Privado>
        }
      >
        <Route index element={<ConPermiso permiso="asignar"><InicioVentas /></ConPermiso>} />
        <Route path="resumen" element={<ConPermiso permiso="resumen"><Dashboard /></ConPermiso>} />
        <Route path="clientes" element={<ConPermiso permiso="clientes"><VistaClientes /></ConPermiso>} />
        <Route path="reportes-dia" element={<ConPermiso permiso="reportes_dia"><ReportesDelDia /></ConPermiso>} />
        <Route path="productos" element={<ConPermiso permiso="productos"><Productos /></ConPermiso>} />
        <Route path="inventario" element={<ConPermiso permiso="inventario"><Inventario /></ConPermiso>} />
        <Route
          path="compras"
          element={
            <ConPermiso permiso="compras"><Compras /></ConPermiso>
          }
        />
        <Route path="asignacion-multiple" element={<ConPermiso permiso="asignacion_multiple"><AsignacionMultiple /></ConPermiso>} />
        <Route path="catalogo" element={<ConPermiso permiso="catalogo"><Catalogo /></ConPermiso>} />
        <Route path="pedidos-catalogo" element={<ConPermiso permiso="pedidos_catalogo"><PedidosCatalogo /></ConPermiso>} />
        <Route path="ventas" element={<ConPermiso permiso="ventas"><Ventas /></ConPermiso>} />
        <Route path="live" element={<ConPermiso permiso="asignar"><Live /></ConPermiso>} />
        <Route path="pedidos-live" element={<ConPermiso permiso="asignar"><PedidosLive /></ConPermiso>} />
        <Route path="cierre-caja" element={<ConPermiso permiso="cierre_caja"><CierreCaja /></ConPermiso>} />
        <Route path="historial-clientes" element={<ConPermiso permiso="historial_clientes"><HistorialClientes /></ConPermiso>} />
        <Route
          path="vendedores"
          element={
            <ConPermiso permiso="vendedores"><Vendedores /></ConPermiso>
          }
        />
        <Route
          path="reporte-vendedores"
          element={
            <ConPermiso permiso="reporte_vendedores"><ReporteVendedores /></ConPermiso>
          }
        />
        <Route
          path="reportes"
          element={
            <ConPermiso permiso="reportes"><Reportes /></ConPermiso>
          }
        />
        <Route
          path="configuracion"
          element={
            <ConPermiso permiso="configuracion"><Configuracion /></ConPermiso>
          }
        />
      </Route>
    </Routes>
    </Suspense>
  );
}
