'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, send, type User } from './api';

type AuthState = {
  /** `undefined` while the session is being checked. */
  user: User | null | undefined;
  setUser: (user: User | null) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api<{ user: User | null }>('/auth/me')
      .then((result) => !cancelled && setUser(result.user))
      .catch(() => !cancelled && setUser(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await send('/auth/logout', 'POST', {}).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, setUser, signOut }), [user, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
