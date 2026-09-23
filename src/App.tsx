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

function Privado({ children }: { children: React.ReactNode }) {
  const { loading, userId } = useAuth();
  if (loading) return <div className="p-6 text-sm">Cargando…</div>;
  if (!userId) return <Navigate to="/login" replace />;
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
        <Route index element={<InicioVentas />} />
        <Route path="resumen" element={<Dashboard />} />
        <Route path="clientes" element={<Clientes />} />
        <Route path="reportes-dia" element={<ReportesDelDia />} />
        <Route path="productos" element={<Productos />} />
        <Route path="inventario" element={<Inventario />} />
        <Route
          path="compras"
          element={
            <SoloAdmin>
              <Compras />
            </SoloAdmin>
          }
        />
        <Route path="asignacion-multiple" element={<AsignacionMultiple />} />
        <Route path="catalogo" element={<Catalogo />} />
        <Route path="pedidos-catalogo" element={<PedidosCatalogo />} />
        <Route path="ventas" element={<Ventas />} />
        <Route path="cierre-caja" element={<SoloAdmin><CierreCaja /></SoloAdmin>} />
        <Route path="historial-clientes" element={<HistorialClientes />} />
        <Route
          path="vendedores"
          element={
            <SoloAdmin>
              <Vendedores />
            </SoloAdmin>
          }
        />
        <Route
          path="reporte-vendedores"
          element={
            <SoloAdmin>
              <ReporteVendedores />
            </SoloAdmin>
          }
        />
        <Route
          path="reportes"
          element={
            <SoloAdmin>
              <Reportes />
            </SoloAdmin>
          }
        />
        <Route
          path="configuracion"
          element={
            <SoloAdmin>
              <Configuracion />
            </SoloAdmin>
          }
        />
      </Route>
    </Routes>
  );
}
