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

export interface RegisterInput {
  company_name: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  acceptInvite: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

let _loading: Promise<void> | null = null;

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

  // Creates the company and its first owner account in one call, and returns an
  // access token, so a new tenant lands straight in the app.
  register: async (input) => {
    const res = await api.post('/auth/register', input);
    const { access_token, user } = res.data.data;
    setAccessToken(access_token);
    set({ user, loading: false });
  },

  // Set a password from an invite (an approved funding application) and sign in.
  acceptInvite: async (token, password) => {
    const res = await api.post('/auth/invite/accept', { token, password });
    const { access_token, user } = res.data.data;
    setAccessToken(access_token);
    set({ user, loading: false });
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },

  loadUser: () => {
    // One restore at a time. Refresh tokens rotate, and presenting the same
    // one twice is treated as theft and revokes the session — which is what
    // happened on every reload in development, where React runs this effect
    // twice, and could happen anywhere two callers raced.
    if (_loading) return _loading;
    _loading = (async () => {
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
    })().finally(() => { _loading = null; });
    return _loading;
  },
}));
