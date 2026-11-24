import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, FolderKanban, FileText, Users, BarChart3,
  LogOut, HardHat, Menu, X, Banknote, Settings,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { api, apiError } from '../../lib/api';
import { toast } from 'sonner';
import { useFundingAccount } from '../../lib/funding';
import logo from '../../assets/onesource-logo.png';
import { clsx } from 'clsx';

export interface Workspace {
  /** The company has at least one job: shows Reports (job costing). Jobs itself is always there. */
  hasJobs: boolean;
  /** Whose name is on the app: One Source for clients it onboarded. */
  brand: 'onesource' | 'constructpm';
}

/**
 * How this company's app is set up. null while it loads.
 *
 * There is one app: invoices, with funding layered on for companies that
 * factor, and jobs for anyone who wants to group invoices by contract. Jobs is
 * always in the menu and never required on an invoice; the deeper project
 * tools (budgets, tasks, subcontracts) live inside a job and Reports appears
 * once a company has a job. `portal_mode: 'funding'`, set when One Source
 * onboards a client, means the company came through One Source: One Source
 * branding.
 */
export function useWorkspace(): Workspace | null {
  const user = useAuthStore((s) => s.user);
  const { data, isError } = useQuery({
    queryKey: ['company-settings', user?.company_id],
    queryFn: () => api.get('/settings/company').then((r) => r.data.data as {
      settings?: { portal_mode?: string; project_tools?: boolean };
    }),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  // Under ['jobs', …], so creating a job (which invalidates ['jobs']) updates it.
  const { data: jobCount } = useQuery({
    queryKey: ['jobs', 'count'],
    queryFn: () => api.get('/jobs', { params: { per_page: 1 } }).then((r) => Number(r.data.meta?.total ?? 0)),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  if (isError) return { hasJobs: true, brand: 'constructpm' };
  if (!data) return null;
  const viaOneSource = data.settings?.portal_mode === 'funding';
  return {
    hasJobs: (jobCount ?? 0) > 0,
    brand: viaOneSource ? 'onesource' : 'constructpm',
  };
}

// Invoices first, then jobs (invoices grouped by contract), funding (the
// layer on invoices), contacts, and Reports once there are jobs to report on.
const nav: { to: string; icon: typeof FileText; label: string; roles?: string[] }[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/invoices',  icon: FileText,        label: 'Invoices' },
  { to: '/jobs',      icon: FolderKanban,    label: 'Jobs' },
  // Funding shows the company's factoring position, so it is limited to the
  // finance-facing roles. The API enforces the same set independently. It is
  // "Funding" for a company that factors and "Get paid now" for one that
  // doesn't yet (see SidebarContent).
  { to: '/funding',   icon: Banknote,        label: 'Funding',
    roles: ['owner', 'admin', 'accountant'] },
  { to: '/contacts',  icon: Users,           label: 'Contacts' },
  { to: '/reports',   icon: BarChart3,       label: 'Reports' },
  { to: '/settings',  icon: Settings,        label: 'Settings', roles: ['owner', 'admin'] },
];

/** One Source's logo on a white tile, so it reads on the dark sidebar. */
function OneSourceMark({ compact }: { compact?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center rounded-md bg-white', compact ? 'px-1.5 py-1' : 'px-2 py-1.5')}>
      <img src={logo} alt="One Source Funding" className={compact ? 'h-6 w-auto' : 'h-8 w-auto'} />
    </span>
  );
}

/** Sidebar contents — identical in the fixed desktop rail and the mobile drawer. */
function SidebarContent({ onNavigate, ws }: { onNavigate?: () => void; ws: Workspace | null }) {
  const { user, logout } = useAuthStore();
  const funding = useFundingAccount();
  // Funding is part of the product only for a company that factors. Everyone
  // else sees the way in instead, and nothing while that's being worked out.
  // Reports is job costing: it shows once the company has a job.
  const items = nav
    .filter((n) => n.to !== '/reports' || ws?.hasJobs)
    .filter((n) => n.to !== '/funding' || funding.isClient || funding.isProspect)
    .map((n) => (n.to === '/funding' && !funding.isClient
      ? { ...n, label: 'Get paid now', invite: true } : { ...n, invite: false }));

  return (
    <>
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-700 flex-shrink-0">
        {ws?.brand === 'onesource' ? <OneSourceMark /> : (
          <>
            <div className="w-8 h-8 rounded bg-brand-600 flex items-center justify-center flex-shrink-0">
              <HardHat className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight">ConstructPM</span>
          </>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {ws !== null && items
          .filter((item) => !item.roles || (user?.role && item.roles.includes(user.role)))
          .map(({ to, icon: Icon, label, invite }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                // min-h-11 keeps every row at a comfortable touch target (~44px).
                'flex items-center gap-3 px-3 min-h-11 rounded-md text-sm font-medium transition-colors',
                isActive ? 'bg-brand-600 text-white'
                  : invite ? 'text-emerald-300 hover:bg-slate-800 hover:text-emerald-200'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="whitespace-nowrap">{label}</span>
            {invite && (
              <span className="ml-auto whitespace-nowrap rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                Up to 90%
              </span>
            )}
          </NavLink>
        ))}
      </nav>


      <div className="px-3 py-4 border-t border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-3 px-3 py-2 rounded-md">
          <NavLink to="/account" onClick={onNavigate} title="Your account"
                   className="flex flex-1 min-w-0 items-center gap-3 rounded-md -m-1 p-1 hover:bg-slate-800">
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
              {user?.first_name?.[0]}{user?.last_name?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.first_name} {user?.last_name}
              </p>
              <p className="text-xs text-slate-400 truncate">Your account</p>
            </div>
          </NavLink>
          {/* Always visible. This was opacity-0 until hover, so there was no way
              to log out at all on a touch device. */}
          <button
            onClick={logout}
            className="p-2 -mr-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const ws = useWorkspace();

  // Close on navigation so tapping a link doesn't leave the drawer over the page.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Escape closes; lock background scroll while the drawer covers the screen.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    // 100dvh, not 100vh: on mobile browsers the URL bar makes vh taller than the
    // visible area, which pushed the bottom of the app off-screen.
    <div className="flex h-[100dvh] bg-slate-50">
      {/* Desktop rail — only from lg up. Below that it ate 240px of a 390px
          screen, which is what made every list page unreadable. */}
      <aside className="hidden lg:flex w-60 flex-col bg-slate-900 text-white flex-shrink-0">
        <SidebarContent ws={ws} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button
            className="absolute inset-0 bg-slate-900/60"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="relative flex w-[17rem] max-w-[85%] flex-col bg-slate-900 text-white shadow-xl"
          >
            <button
              ref={closeRef}
              onClick={() => setDrawerOpen(false)}
              className="absolute top-4 right-3 p-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent ws={ws} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* min-w-0 lets this column shrink below its content width, which is what
          allows inner tables to scroll instead of forcing the whole page wide. */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center gap-3 h-14 px-4 bg-slate-900 text-white flex-shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-2 rounded-md hover:bg-slate-800"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <Menu className="w-5 h-5" />
          </button>
          {ws?.brand === 'onesource' ? <OneSourceMark compact /> : (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-brand-600 flex items-center justify-center">
                <HardHat className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-sm tracking-tight">ConstructPM</span>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <ConfirmEmailBanner />
          {ws === null
            ? <div className="p-10 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-400" /></div>
            : <Outlet />}
        </main>
      </div>
    </div>
  );
}

/** A new self-serve account hasn't confirmed its email yet: a quiet reminder with a resend. */
function ConfirmEmailBanner() {
  const user = useAuthStore((s) => s.user);
  const [sent, setSent] = useState(false);
  if (!user || user.email_verified !== false) return null;
  const resend = () => api.post('/auth/email/verify/resend')
    .then(() => setSent(true))
    .catch((e) => toast.error(apiError(e, 'Couldn’t send it')));
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>Confirm your email: we sent a link to <strong>{user.email}</strong>.</span>
      {sent ? <span className="text-amber-700">Sent again.</span>
            : <button className="font-medium underline" onClick={() => void resend()}>Resend</button>}
    </div>
  );
}
