import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RequireRole } from "./components/RequireRole";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { KitsPage } from "./pages/KitsPage";
import { KitDetailPage } from "./pages/KitDetailPage";
import { EntitiesPage } from "./pages/EntitiesPage";
import { RequestsPage } from "./pages/RequestsPage";
import { RequestDetailPage } from "./pages/RequestDetailPage";
import { RequestsCalendarPage } from "./pages/RequestsCalendarPage";
import { EntityDetailPage } from "./pages/EntityDetailPage";
import { UsersPage } from "./pages/UsersPage";
import { ComponentsPage } from "./pages/ComponentsPage";
import { ComponentDetailPage } from "./pages/ComponentDetailPage";
import { PrintLabelsPage } from "./pages/PrintLabelsPage";
import { StatsPage } from "./pages/StatsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { MaintenancePage } from "./pages/MaintenancePage";
import { OnCallPage } from "./pages/OnCallPage";
import { Toaster } from "./components/ui/toaster";
import { ErrorBoundary } from "./components/ErrorBoundary";

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function CanDecideOnly({ children }: { children: React.ReactNode }) {
  const { canDecideRequests, loading } = useAuth();
  if (loading) return null;
  if (!canDecideRequests) return <Navigate to="/dashboard" replace />;
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
            <Route path="kits" element={<RequireRole><KitsPage /></RequireRole>} />
            <Route path="kits/:id" element={<RequireRole><KitDetailPage /></RequireRole>} />
            <Route path="entities" element={<RequireRole><EntitiesPage /></RequireRole>} />
            <Route path="entities/:id" element={<RequireRole><EntityDetailPage /></RequireRole>} />
            <Route path="requests" element={<RequireRole><RequestsPage /></RequireRole>} />
            {/* Calendar is read-only — viewers + user role + above can see. Status filter narrows further. */}
            <Route path="requests/calendar" element={<RequireRole><RequestsCalendarPage /></RequireRole>} />
            <Route path="requests/:id" element={<RequireRole><RequestDetailPage /></RequireRole>} />
            <Route path="users" element={<AdminOnly><UsersPage /></AdminOnly>} />
            <Route path="audit" element={<AdminOnly><AuditLogPage /></AdminOnly>} />
            <Route path="components" element={<RequireRole><ComponentsPage /></RequireRole>} />
            <Route path="components/:id" element={<RequireRole><ComponentDetailPage /></RequireRole>} />
            <Route path="kits/print" element={<AdminOnly><PrintLabelsPage /></AdminOnly>} />
            <Route path="maintenance" element={<CanDecideOnly><MaintenancePage /></CanDecideOnly>} />
            <Route path="stats" element={<CanDecideOnly><StatsPage /></CanDecideOnly>} />
            <Route path="oncall" element={<RequireRole><OnCallPage /></RequireRole>} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}
