import axios from 'axios';

// SECURITY: Access token lives in memory only — never localStorage or sessionStorage.
// This protects against XSS token theft. The refresh token is in an httpOnly cookie
// (managed by the browser, inaccessible to JS) and is used to silently get new tokens.
let _accessToken: string | null = null;

export function setAccessToken(token: string | null) { _accessToken = token; }
export function getAccessToken(): string | null { return _accessToken; }

export const api = axios.create({
  // Every page calls bare paths ('/jobs', '/subcontracts', ...), so the API prefix
  // belongs in the baseURL. Default to '/api' (the Vite dev proxy and prod both
  // serve the API under /api). `||` (not `??`) so an empty VITE_API_URL build arg
  // still falls back to '/api'; set VITE_API_URL for a split-origin API.
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,   // Sends the httpOnly refresh_token cookie automatically
  timeout: 30_000,
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return config;
});

// Silent token refresh on 401
let _refreshPromise: Promise<string | null> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Never try to refresh the refresh call itself. The auth store probes
    // /auth/refresh on every page load to restore a session; when there is no
    // cookie that 401s, and treating it as "session expired" sent the browser to
    // /login via a full page load — which remounted the app, probed again, and
    // reloaded forever. Let the caller handle this 401.
    const url: string = originalRequest?.url ?? '';
    const isAuthProbe = url.includes('/auth/refresh') || url.includes('/auth/login');

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthProbe) {
      originalRequest._retry = true;

      // Deduplicate concurrent refresh calls
      if (!_refreshPromise) {
        _refreshPromise = axios
          .post('/api/auth/refresh', {}, { withCredentials: true })
          .then((r) => {
            const token: string = r.data.data.access_token;
            setAccessToken(token);
            return token;
          })
          .catch(() => {
            setAccessToken(null);
            // Redirect via the router-friendly path, and only when we're not
            // already on an auth screen — assigning location while /login is
            // open is what produced the reload loop.
            const path = window.location.pathname;
            if (path !== '/login' && path !== '/register') {
              window.location.assign('/login');
            }
            return null;
          })
          .finally(() => { _refreshPromise = null; });
      }

      const newToken = await _refreshPromise;
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }
    }

    return Promise.reject(error);
  }
);

// ─── Utilities ────────────────────────────────────────────────────────────────
export function formatCurrency(
  n: number | string | null | undefined,
  opts?: { short?: boolean }
): string {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    ...(opts?.short ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
  }).format(num);
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatPct(n: number | string | null | undefined): string {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  return `${num.toFixed(1)}%`;
}
