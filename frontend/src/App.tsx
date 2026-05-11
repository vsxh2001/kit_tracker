import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { KitsPage } from "./pages/KitsPage";
import { KitDetailPage } from "./pages/KitDetailPage";
import { EntitiesPage } from "./pages/EntitiesPage";
import { RequestsPage } from "./pages/RequestsPage";
import { RequestDetailPage } from "./pages/RequestDetailPage";
import { EntityDetailPage } from "./pages/EntityDetailPage";
import { UsersPage } from "./pages/UsersPage";
import { ComponentsPage } from "./pages/ComponentsPage";
import { ComponentDetailPage } from "./pages/ComponentDetailPage";
import { Toaster } from "./components/ui/toaster";
import { ErrorBoundary } from "./components/ErrorBoundary";

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <Toaster />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="kits" element={<KitsPage />} />
            <Route path="kits/:id" element={<KitDetailPage />} />
            <Route path="entities" element={<EntitiesPage />} />
            <Route path="entities/:id" element={<EntityDetailPage />} />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="requests/:id" element={<RequestDetailPage />} />
            <Route path="users" element={<AdminOnly><UsersPage /></AdminOnly>} />
            <Route path="components" element={<ComponentsPage />} />
            <Route path="components/:id" element={<ComponentDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}
