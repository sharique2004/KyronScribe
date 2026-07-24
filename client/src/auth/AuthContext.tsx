import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api, bus, ApiError } from '@/api/client';
import type { SafeUser } from '@/types';
import { ReLoginModal } from './ReLoginModal';
import { DeactivatedScreen } from './DeactivatedScreen';

interface AuthContextValue {
  user: SafeUser | null;
  /** True until the initial GET /auth/me resolves. */
  booting: boolean;
  login: (email: string, password: string) => Promise<SafeUser>;
  logout: () => Promise<void>;
  /**
   * Run an API action such that, if it fails with SESSION_EXPIRED, the action is
   * queued and transparently re-run after the user re-authenticates — the original
   * promise resolves/rejects with the retried result. This is N2's zero-data-loss
   * mechanism (PRD §7.4): the caller's save "just works" across a session timeout.
   */
  runWithAuthRetry: <T>(fn: () => Promise<T>) => Promise<T>;
}

interface QueuedAction {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [deactivated, setDeactivated] = useState(false);

  // Actions parked while re-authenticating; flushed on successful re-login.
  const retryQueue = useRef<QueuedAction[]>([]);

  // --- Boot: who am I? Also the deactivation tripwire on first load. ---
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ user: SafeUser }>('/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        // 401 here is the normal logged-out boot — swallow. The client only
        // emits 'session-expired' when code === SESSION_EXPIRED; on the very
        // first load we ignore the modal by resetting below.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) {
          setSessionExpired(false); // never show re-login modal during boot
          setBooting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Auth lifecycle events from the API client. ---
  useEffect(() => {
    const offExpired = bus.on('session-expired', () => {
      // Only meaningful once we're past boot and actually have a user.
      setSessionExpired(true);
    });
    const offDeactivated = bus.on('account-deactivated', () => {
      setDeactivated(true);
    });
    return () => {
      offExpired();
      offDeactivated();
    };
  }, []);

  const flushQueue = useCallback(async () => {
    const pending = retryQueue.current;
    retryQueue.current = [];
    for (const action of pending) {
      try {
        action.resolve(await action.run());
      } catch (err) {
        action.reject(err);
      }
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<SafeUser> => {
      const res = await api.post<{ user: SafeUser }>('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });
      setUser(res.user);
      setDeactivated(false);
      // If this login resolved a session-expiry, replay the parked actions.
      if (sessionExpired) {
        setSessionExpired(false);
        await flushQueue();
      }
      return res.user;
    },
    [sessionExpired, flushQueue],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* best-effort; clear local state regardless */
    }
    // Reject anything still queued so no caller hangs forever.
    const pending = retryQueue.current;
    retryQueue.current = [];
    pending.forEach((a) =>
      a.reject(new ApiError(401, 'SESSION_EXPIRED', 'Signed out before retry.')),
    );
    setUser(null);
    setSessionExpired(false);
    setDeactivated(false);
  }, []);

  const runWithAuthRetry = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> => {
      return fn().catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'SESSION_EXPIRED') {
          // Park the action; the re-login modal is already surfacing via the bus.
          return new Promise<T>((resolve, reject) => {
            retryQueue.current.push({
              run: fn as () => Promise<unknown>,
              resolve: resolve as (v: unknown) => void,
              reject,
            });
          });
        }
        throw err;
      });
    },
    [],
  );

  const value: AuthContextValue = {
    user,
    booting,
    login,
    logout,
    runWithAuthRetry,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {/* N3 wins over N2: a deactivated account should not see a re-login prompt. */}
      {deactivated ? (
        <DeactivatedScreen onSignOut={logout} />
      ) : (
        sessionExpired &&
        user && (
          <ReLoginModal email={user.email} onReLogin={async (e, p) => void (await login(e, p))} onSignOut={logout} />
        )
      )}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
