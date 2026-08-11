import axios from 'axios';
import { create } from 'zustand';

/**
 * Operator API client.
 *
 * Deliberately a separate axios instance and a separate token variable from the
 * tenant client in lib/api.ts. The operator credential reaches across every
 * client, so it must never ride along on a tenant request, and a tenant token
 * must never be sent to an admin route — the server enforces this with a
 * different JWT audience, and this keeps the client side honest about it too.
 *
 * In memory only, as with the tenant token: no localStorage, so an XSS cannot
 * lift a cross-tenant credential out of storage.
 */
let _adminToken: string | null = null;

export const adminApi = axios.create({
  baseURL: '/api/admin',
  timeout: 30_000,
});

adminApi.interceptors.request.use((config) => {
  if (_adminToken) config.headers.Authorization = `Bearer ${_adminToken}`;
  return config;
});

adminApi.interceptors.response.use(
  (r) => r,
  (error) => {
    // Operator sessions are short (1h) and there is no refresh flow: re-auth is
    // the correct response for a credential this powerful.
    if (error.response?.status === 401 && !window.location.pathname.endsWith('/admin')) {
      _adminToken = null;
      window.location.assign('/admin');
    }
    return Promise.reject(error);
  }
);

interface AdminState {
  email: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  email: null,
  ready: true,
  login: async (email, password) => {
    const r = await adminApi.post('/auth/login', { email, password });
    _adminToken = r.data.data.access_token;
    set({ email: r.data.data.user.email });
  },
  logout: () => {
    _adminToken = null;
    set({ email: null });
    window.location.assign('/admin');
  },
}));

export function hasAdminToken() {
  return _adminToken !== null;
}
