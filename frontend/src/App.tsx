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
import { ScheduleDetailPage } from "./pages/ScheduleDetailPage";
import { OnCallPage } from "./pages/OnCallPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ScanPage } from "./pages/ScanPage";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { WhatsAppSettingsPage } from "./pages/WhatsAppSettingsPage";
import { WhatsAppBroadcastPage } from "./pages/WhatsAppBroadcastPage";
import { WhatsAppConversationsPage } from "./pages/WhatsAppConversationsPage";
import { WhatsAppScheduledBroadcastsPage } from "./pages/WhatsAppScheduledBroadcastsPage";
import { WhatsAppTemplatesPage } from "./pages/WhatsAppTemplatesPage";
import { Toaster } from "./components/ui/toaster";
import { ErrorBoundary } from "./components/ErrorBoundary";

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
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
          <Route path="/invite/:token" element={<InviteAcceptPage />} />
          <Route path="/scan/:kitId" element={<ScanPage />} />
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
            <Route path="audit" element={<CanDecideOnly><AuditLogPage /></CanDecideOnly>} />
            <Route path="components" element={<RequireRole><ComponentsPage /></RequireRole>} />
            <Route path="components/:id" element={<RequireRole><ComponentDetailPage /></RequireRole>} />
            <Route path="kits/print" element={<AdminOnly><PrintLabelsPage /></AdminOnly>} />
            <Route path="maintenance" element={<CanDecideOnly><MaintenancePage /></CanDecideOnly>} />
            <Route path="maintenance/:scheduleId" element={<ProtectedRoute><ScheduleDetailPage /></ProtectedRoute>} />
            <Route path="stats" element={<CanDecideOnly><StatsPage /></CanDecideOnly>} />
            <Route path="oncall" element={<RequireRole><OnCallPage /></RequireRole>} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="products" element={<RequireRole><ProductsPage /></RequireRole>} />
            <Route path="products/:id" element={<RequireRole><ProductDetailPage /></RequireRole>} />
            <Route path="settings/whatsapp" element={<AdminOnly><WhatsAppSettingsPage /></AdminOnly>} />
            <Route path="settings/whatsapp/broadcast" element={<AdminOnly><WhatsAppBroadcastPage /></AdminOnly>} />
            <Route path="settings/whatsapp/conversations" element={<AdminOnly><WhatsAppConversationsPage /></AdminOnly>} />
            <Route path="settings/whatsapp/scheduled" element={<AdminOnly><WhatsAppScheduledBroadcastsPage /></AdminOnly>} />
            <Route path="settings/whatsapp/templates" element={<AdminOnly><WhatsAppTemplatesPage /></AdminOnly>} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}
