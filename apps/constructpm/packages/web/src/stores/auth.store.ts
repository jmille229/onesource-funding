import { create } from 'zustand';
import { api, setAccessToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  company_id: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { access_token, user } = res.data.data;
    // SECURITY: Token stored in memory only — not localStorage
    setAccessToken(access_token);
    set({ user });
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },

  loadUser: async () => {
    // On page load: silently refresh access token using httpOnly cookie,
    // then load user profile. If refresh fails, user stays logged out.
    set({ loading: true });
    try {
      const refreshRes = await api.post('/auth/refresh', {}, { withCredentials: true });
      const token: string = refreshRes.data.data.access_token;
      setAccessToken(token);
      const userRes = await api.get('/auth/me');
      set({ user: userRes.data.data, loading: false });
    } catch {
      setAccessToken(null);
      set({ user: null, loading: false });
    }
  },
}));
