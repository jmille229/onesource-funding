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

    if (error.response?.status === 401 && !originalRequest._retry) {
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
            window.location.href = '/login';
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
