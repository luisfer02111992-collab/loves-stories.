import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Clientes from "./pages/Clientes";
import ReportesDelDia from "./pages/ReportesDelDia";
import Productos from "./pages/Productos";
import Inventario from "./pages/Inventario";
import Compras from "./pages/Compras";
import Asignacion from "./pages/Asignacion";
import AsignacionMultiple from "./pages/AsignacionMultiple";
import Catalogo from "./pages/Catalogo";
import CatalogoPublico from "./pages/CatalogoPublico";
import Reportes from "./pages/Reportes";
import Papelera from "./pages/Papelera";
import Configuracion from "./pages/Configuracion";
import PedidosCatalogo from "./pages/PedidosCatalogo";
import Ventas from "./pages/Ventas";

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
        <Routes>
          {/* El catálogo público se ve sin iniciar sesión, con un link para compartir por WhatsApp */}
          <Route path="/catalogo-publico" element={<CatalogoPublico />} />
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <Privado>
                <Layout />
              </Privado>
            }
          >
            <Route index element={<Dashboard />} />
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
            <Route path="asignacion" element={<Asignacion />} />
            <Route path="asignacion-multiple" element={<AsignacionMultiple />} />
            <Route path="catalogo" element={<Catalogo />} />
            <Route path="pedidos-catalogo" element={<PedidosCatalogo />} />
            <Route path="ventas" element={<Ventas />} />
            <Route
              path="reportes"
              element={
                <SoloAdmin>
                  <Reportes />
                </SoloAdmin>
              }
            />
            <Route
              path="papelera"
              element={
                <SoloAdmin>
                  <Papelera />
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
      </AuthProvider>
    </BrowserRouter>
  );
}
