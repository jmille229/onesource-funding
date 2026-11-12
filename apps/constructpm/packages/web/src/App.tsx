import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useAuthStore } from './stores/auth.store';
import { AppLayout, usePortalMode } from './components/layout/AppLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/jobs/JobsPage';
import { JobDetailPage } from './pages/jobs/JobDetailPage';
import { JobNewPage } from './pages/jobs/JobNewPage';
import { BudgetPage } from './pages/budget/BudgetPage';
import { SubcontractsPage } from './pages/subcontracts/SubcontractsPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { InvoicesPage } from './pages/invoices/InvoicesPage';
import { ContactsPage } from './pages/contacts/ContactsPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { FactoringPage } from './pages/factoring/FactoringPage';
import { AdminConsolePage } from './pages/admin/AdminConsolePage';
import { ApplyPage } from './pages/apply/ApplyPage';
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage';

// apply.os-funding.com serves the same bundle, but only the funding
// application: no login, no session probe, no other routes.
const isApplyHost = window.location.hostname.startsWith('apply.');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/** Funding-only clients land on Funding; everyone else on the dashboard. */
function HomeRedirect() {
  const mode = usePortalMode();
  if (mode === null) return null;
  return <Navigate to={mode === 'funding' ? '/funding' : '/dashboard'} replace />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }
  // SECURITY: No localStorage check — relies on in-memory token + silent refresh
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  if (isApplyHost) {
    return (
      <>
        <Toaster position="top-center" richColors />
        <ApplyPage />
      </>
    );
  }
  return <SoftwareApp />;
}

function SoftwareApp() {
  const loadUser = useAuthStore((s) => s.loadUser);

  // On mount: attempt silent refresh to restore session from httpOnly cookie
  useEffect(() => { loadUser(); }, [loadUser]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          {/* The application also lives here, for local development and as a
              fallback before the apply subdomain is set up. */}
          <Route path="/apply" element={<ApplyPage />} />
          <Route path="/admin" element={<AdminConsolePage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<HomeRedirect />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="jobs/new" element={<JobNewPage />} />
            <Route path="jobs/:id" element={<JobDetailPage />} />
            <Route path="jobs/:id/budget" element={<BudgetPage />} />
            <Route path="jobs/:id/tasks" element={<TasksPage />} />
            <Route path="jobs/:id/subcontracts" element={<SubcontractsPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="funding" element={<FactoringPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
