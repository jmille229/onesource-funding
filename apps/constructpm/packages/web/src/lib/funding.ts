import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthStore } from '../stores/auth.store';
import { canSeeFunding } from './invoices';

/**
 * Where this company stands with One Source, for deciding what the app shows.
 *
 *   client  — has a factoring account (funded history, even if paused): the
 *             funding layer is part of their invoices — badges, filters, the
 *             Funding area.
 *   active  — can request funding right now.
 *   neither — invoice management only, plus the way in: "Get paid now".
 *
 * Funding is only ever shown to the finance roles (owner, admin, accountant);
 * the API enforces the same set.
 */
export interface FundingSummary {
  enabled: boolean;
  status?: string;
  funding_available?: number | null;
  [k: string]: unknown;
}

export function useFundingAccount() {
  const role = useAuthStore((s) => s.user?.role);
  const canSee = canSeeFunding(role);
  const { data, isLoading } = useQuery<FundingSummary | null>({
    queryKey: ['factoring-summary'],
    queryFn: () => api.get('/factoring/summary').then((r) => r.data.data).catch(() => null),
    enabled: canSee,
    staleTime: 60_000,
  });
  const isClient = canSee && data?.enabled === true;
  return {
    /** May see funding at all (role). */
    canSee,
    loading: canSee && isLoading,
    summary: data ?? null,
    isClient,
    isActive: isClient && data?.status === 'active',
    /** A finance user at a company that doesn't factor (yet): show the way in. */
    isProspect: canSee && !isLoading && data?.enabled !== true,
  };
}

/** Typical and maximum advance, as One Source quotes them. */
export const ADVANCE_TYPICAL = 0.8;
export const ADVANCE_MAX = 0.9;

/** Remember a dismissed prompt for a while, per browser. Never required to work. */
export function dismissedRecently(key: string, days: number): boolean {
  try {
    const at = Number(window.localStorage.getItem(`dismissed:${key}`) ?? 0);
    return at > 0 && Date.now() - at < days * 86400_000;
  } catch {
    return false;
  }
}
export function dismiss(key: string) {
  try { window.localStorage.setItem(`dismissed:${key}`, String(Date.now())); } catch { /* fine */ }
}
