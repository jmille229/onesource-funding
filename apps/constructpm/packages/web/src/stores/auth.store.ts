import { create } from 'zustand';
import { queryClient } from '../lib/queryClient';
import { api, setAccessToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  company_id: string;
  /** From /auth/me. False for a new self-serve account until the emailed link is used. */
  email_verified?: boolean;
  mfa_enabled?: boolean;
}

/**
 * Signing in is done, or needs a second step: a code from an authenticator
 * app ('verify'), or setting one up because the company requires it ('setup').
 */
export type SignInResult = { done: true } | { done: false; mode: 'verify' | 'setup'; challenge: string };

export interface RegisterInput {
  company_name: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  /** Bot checks: a hidden field (should stay empty) and how long the form was open. */
  website?: string;
  form_ms?: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SignInResult>;
  register: (input: RegisterInput) => Promise<void>;
  acceptInvite: (token: string, password: string) => Promise<SignInResult>;
  /** Open the session from a sign-in response (after the second step). */
  finishSignIn: (data: { access_token: string }) => Promise<void>;
  /** Re-read the profile (e.g. after confirming the email). */
  reloadUser: () => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

let _loading: Promise<void> | null = null;

type SignInData = { access_token?: string; mfa_required?: boolean; mfa_setup_required?: boolean; challenge?: string };

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    return settle(res.data.data, get().finishSignIn);
  },

  finishSignIn: async (data) => {
    // Nothing cached for whoever used this tab before may show for this account.
    queryClient.clear();
    // SECURITY: Token stored in memory only — not localStorage
    setAccessToken(data.access_token);
    const me = await api.get('/auth/me');
    set({ user: me.data.data, loading: false });
  },

  reloadUser: async () => {
    const me = await api.get('/auth/me');
    set({ user: me.data.data });
  },

  // Creates the company and its first owner account in one call, and returns an
  // access token, so a new tenant lands straight in the app.
  register: async (input) => {
    const res = await api.post('/auth/register', input);
    await get().finishSignIn({ access_token: res.data.data.access_token });
  },

  // Set a password from an invite (an approved funding application) and sign in.
  // Also redeems a password-reset link: same endpoint, same rules.
  acceptInvite: async (token, password) => {
    const res = await api.post('/auth/invite/accept', { token, password });
    return settle(res.data.data, get().finishSignIn);
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      set({ user: null });
      queryClient.clear();
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

async function settle(data: SignInData, finish: (d: { access_token: string }) => Promise<void>): Promise<SignInResult> {
  if (data.mfa_required) return { done: false, mode: 'verify', challenge: data.challenge! };
  if (data.mfa_setup_required) return { done: false, mode: 'setup', challenge: data.challenge! };
  await finish({ access_token: data.access_token! });
  return { done: true };
}
