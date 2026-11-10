import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken, setUnauthenticatedHandler } from './api';

export interface User {
  id: string; email: string; fullName: string; role: 'student' | 'teacher' | 'admin'; status: string;
  avatarFileId: string | null; teacherStatus: 'pending' | 'approved' | 'rejected' | 'needs_info' | null;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const client = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setCsrfToken(me.csrfToken);
      setUser(me.user);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 401) setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => { setUser(null); client.clear(); });
    void refresh();
  }, [refresh, client]);

  const value = useMemo<AuthState>(() => ({
    user, loading, refresh,
    async login(email, password) {
      const result = await api.post('/auth/login', { email, password });
      setCsrfToken(result.csrfToken);
      client.clear();
      setUser(result.user);
      return result.user;
    },
    async logout() {
      try { await api.post('/auth/logout'); } finally { setUser(null); client.clear(); }
    },
  }), [user, loading, refresh, client]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const homeFor = (user: User) => (user.role === 'admin' ? '/admin' : '/app');

/** Live updates over WebSocket, with polling as the fallback when the socket is down. */
export function useRealtime(enabled: boolean) {
  const client = useQueryClient();
  const retry = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let poll: number | undefined;
    let stopped = false;
    const invalidate = () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
      void client.invalidateQueries({ queryKey: ['conversations'] });
    };
    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/ws`);
      socket.onopen = () => { retry.current = 0; if (poll) { clearInterval(poll); poll = undefined; } };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'message') void client.invalidateQueries({ queryKey: ['messages', data.message.conversationId] });
        invalidate();
      };
      socket.onclose = () => {
        if (stopped) return;
        poll ??= window.setInterval(() => void client.invalidateQueries({ type: 'active' }), 20000);
        retry.current = Math.min(retry.current + 1, 6);
        timer = window.setTimeout(connect, 1000 * 2 ** retry.current);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(poll);
      socket?.close();
    };
  }, [enabled, client]);
}
