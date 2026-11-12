import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, FolderKanban, FileText, Users, BarChart3,
  LogOut, HardHat, Menu, X, Banknote, LayoutGrid,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/auth.store';
import { api, apiError } from '../../lib/api';
import logo from '../../assets/onesource-logo.png';
import { clsx } from 'clsx';

/**
 * 'funding' — a client onboarded through apply.os-funding.com, who came for
 * funding and not the project tools: they see Funding only, branded One
 * Source. 'full' is everyone else. null while it loads.
 */
export function usePortalMode(): 'funding' | 'full' | null {
  const user = useAuthStore((s) => s.user);
  const { data, isError } = useQuery({
    queryKey: ['company-settings', user?.company_id],
    queryFn: () => api.get('/settings/company').then((r) => r.data.data as { settings?: { portal_mode?: string } }),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  if (isError) return 'full';
  if (!data) return null;
  return data.settings?.portal_mode === 'funding' ? 'funding' : 'full';
}

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/jobs',      icon: FolderKanban,    label: 'Jobs' },
  { to: '/invoices',  icon: FileText,        label: 'Invoices' },
  { to: '/contacts',  icon: Users,           label: 'Contacts' },
  { to: '/reports',   icon: BarChart3,       label: 'Reports' },
  // Funding shows the company's factoring position, so it is limited to the
  // finance-facing roles. The API enforces the same set independently.
  { to: '/funding',   icon: Banknote,        label: 'Funding',
    roles: ['owner', 'admin', 'accountant'] },
];

const fundingNav = nav.filter((n) => n.to === '/funding');

/** One Source's logo on a white tile, so it reads on the dark sidebar. */
function OneSourceMark({ compact }: { compact?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center rounded-md bg-white', compact ? 'px-1.5 py-1' : 'px-2 py-1.5')}>
      <img src={logo} alt="One Source Funding" className={compact ? 'h-6 w-auto' : 'h-8 w-auto'} />
    </span>
  );
}

/** Funding-only clients can switch the project and invoice tools on themselves. */
function TurnOnTools() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!['owner', 'admin'].includes(user?.role ?? '')) return null;
  const turnOn = async () => {
    if (!window.confirm('Turn on jobs, invoices, contacts and reports for your team? You can keep using Funding exactly as you do now.')) return;
    setBusy(true);
    try {
      await api.patch('/settings/company', { settings: { portal_mode: 'full' } });
      await qc.invalidateQueries({ queryKey: ['company-settings'] });
      toast.success('Project and invoice tools are on');
    } catch (e) {
      toast.error(apiError(e, 'Couldn’t turn them on'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-3 mb-3 rounded-md border border-slate-700 p-3">
      <p className="text-xs text-slate-300">Want to track jobs and invoices here too?</p>
      <button onClick={() => void turnOn()} disabled={busy}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-white hover:underline disabled:opacity-50">
        <LayoutGrid className="w-3.5 h-3.5" /> Turn on project &amp; invoice tools
      </button>
    </div>
  );
}

/** Sidebar contents — identical in the fixed desktop rail and the mobile drawer. */
function SidebarContent({ onNavigate, mode }: { onNavigate?: () => void; mode: 'funding' | 'full' | null }) {
  const { user, logout } = useAuthStore();
  const items = mode === 'funding' ? fundingNav : nav;

  return (
    <>
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-700 flex-shrink-0">
        {mode === 'funding' ? <OneSourceMark /> : (
          <>
            <div className="w-8 h-8 rounded bg-brand-600 flex items-center justify-center flex-shrink-0">
              <HardHat className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight">ConstructPM</span>
          </>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {mode !== null && items
          .filter((item) => !item.roles || (user?.role && item.roles.includes(user.role)))
          .map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                // min-h-11 keeps every row at a comfortable touch target (~44px).
                'flex items-center gap-3 px-3 min-h-11 rounded-md text-sm font-medium transition-colors',
                isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {mode === 'funding' && <TurnOnTools />}

      <div className="px-3 py-4 border-t border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-3 px-3 py-2 rounded-md">
          <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
            {user?.first_name?.[0]}{user?.last_name?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-xs text-slate-400 capitalize truncate">
              {user?.role?.replace('_', ' ')}
            </p>
          </div>
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
  const mode = usePortalMode();

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
        <SidebarContent mode={mode} />
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
            <SidebarContent mode={mode} onNavigate={() => setDrawerOpen(false)} />
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
          {mode === 'funding' ? <OneSourceMark compact /> : (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-brand-600 flex items-center justify-center">
                <HardHat className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-sm tracking-tight">ConstructPM</span>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Funding-only: every other screen leads back to Funding. */}
          {mode === null
            ? <div className="p-10 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-400" /></div>
            : mode === 'funding' && !location.pathname.startsWith('/funding')
              ? <Navigate to="/funding" replace />
              : <Outlet />}
        </main>
      </div>
    </div>
  );
}
