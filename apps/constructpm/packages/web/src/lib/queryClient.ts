import { QueryClient } from '@tanstack/react-query';

/**
 * The app's one query cache. Most query keys don't name the company (['invoices',
 * 'summary'], …), so the cache must be emptied whenever who's signed in
 * changes, or the next account in the same tab is shown the previous one's
 * figures until they go stale (auth.store does this on sign-in and sign-out).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
