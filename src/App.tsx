import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { SellerSessionProvider } from "./hooks/useSellerSession";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import InicioVentas from "./pages/InicioVentas";
import Clientes from "./pages/Clientes";
import ReportesDelDia from "./pages/ReportesDelDia";
import Productos from "./pages/Productos";
import Inventario from "./pages/Inventario";
import Compras from "./pages/Compras";
import AsignacionMultiple from "./pages/AsignacionMultiple";
import Catalogo from "./pages/Catalogo";
import CatalogoPublico from "./pages/CatalogoPublico";
import Reportes from "./pages/Reportes";
import Configuracion from "./pages/Configuracion";
import PedidosCatalogo from "./pages/PedidosCatalogo";
import Ventas from "./pages/Ventas";
import ResetPassword from "./pages/ResetPassword";
import Vendedores from "./pages/Vendedores";
import ReporteVendedores from "./pages/ReporteVendedores";
import CierreCaja from "./pages/CierreCaja";
import HistorialClientes from "./pages/HistorialClientes";
import { canAccess, type PermissionKey } from "./lib/permissions";

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

function AppRoutes() {
  const { recovery } = useAuth();

  // El enlace de recuperación de Supabase puede caer en cualquier ruta de la app
  // (según la Site URL configurada en Supabase). En cuanto detectamos la sesión de
  // recuperación (evento PASSWORD_RECOVERY, ver useAuth), mostramos siempre la
  // pantalla de nueva contraseña, sin importar la ruta, hasta que el usuario la cambie.
  if (recovery) {
    return (
      <Routes>
        <Route path="*" element={<ResetPassword />} />
      </Routes>
    );
  }

  return (
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
        <Route path="clientes" element={<ConPermiso permiso="clientes"><Clientes /></ConPermiso>} />
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
  );
}
