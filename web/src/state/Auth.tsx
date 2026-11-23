import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthMe } from '@api/types';
import { api, onUnauthorized } from '../api';

type AuthState = { status: 'loading' } | { status: 'out' } | { status: 'in'; email: string };

interface AuthApi {
  state: AuthState;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    onUnauthorized(() => setState({ status: 'out' }));
    api
      .get<AuthMe>('/api/auth/me')
      .then((me) => setState({ status: 'in', email: me.email }))
      .catch(() => setState({ status: 'out' }));
    return () => onUnauthorized(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await api.post<AuthMe>('/api/auth/login', { email, password });
    setState({ status: 'in', email: me.email });
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setState({ status: 'out' });
  }, []);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
