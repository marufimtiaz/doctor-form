import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate } from "react-router-dom";

import {
  login as loginRequest,
  me,
  setUnauthorizedHandler,
  TOKEN_KEY,
  type UserPublic,
} from "@/api";

interface Auth {
  user: UserPublic | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    // Any 401 from anywhere drops us back to the login screen.
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    // A stored token may be expired or revoked; /auth/me is what settles it.
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const resp = await loginRequest(phone, password);
    localStorage.setItem(TOKEN_KEY, resp.access_token);
    setUser(resp.user);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** The role now comes from a signed token rather than a value the client chose,
 *  so this is a real check - but the server's 403 is still the enforcement. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!user || user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
