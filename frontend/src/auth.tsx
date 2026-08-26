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

import { listUsers, USER_ID_KEY, type UserPublic } from "./api";

interface Identity {
  user: UserPublic | null;
  users: UserPublic[];
  loading: boolean;
  switchUser: (id: string) => void;
  clear: () => void;
}

const IdentityContext = createContext<Identity | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [userId, setUserId] = useState<string | null>(() =>
    localStorage.getItem(USER_ID_KEY),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  const switchUser = useCallback((id: string) => {
    localStorage.setItem(USER_ID_KEY, id);
    setUserId(id);
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(USER_ID_KEY);
    setUserId(null);
  }, []);

  // A stored id that no longer matches a real user (deactivated, or the
  // database was reset) must not leave the app stuck sending 401s.
  const user = useMemo(
    () => users.find((u) => u.id === userId) ?? null,
    [users, userId],
  );

  const value = useMemo(
    () => ({ user, users, loading, switchUser, clear }),
    [user, users, loading, switchUser, clear],
  );

  return (
    <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
  );
}

export function useIdentity(): Identity {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used inside IdentityProvider");
  return ctx;
}

/** UX guard only. The identity is client-chosen, so anyone can set the
 *  localStorage key - the real enforcement is the server's 403. This exists so
 *  an agent does not land on a page that would only show them errors. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useIdentity();
  if (loading) return <p className="muted">Loading…</p>;
  if (!user || user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function IdentityPicker() {
  const { users, switchUser, loading } = useIdentity();
  if (loading) return <p className="muted">Loading…</p>;
  return (
    <main className="wrap">
      <header>
        <h1>Who are you?</h1>
        <p className="sub">
          Pick your name to continue. There is no password yet — this selects a
          role, it does not prove one.
        </p>
      </header>
      <ul className="list">
        {users.map((u) => (
          <li key={u.id} className="card">
            <button className="link" onClick={() => switchUser(u.id)}>
              <strong>{u.name}</strong> · {u.company} · {u.role}
            </button>
          </li>
        ))}
      </ul>
      {users.length === 0 && <p className="muted">No users exist yet.</p>}
    </main>
  );
}
