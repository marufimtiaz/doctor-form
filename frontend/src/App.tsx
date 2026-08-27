import { Link, Navigate, Route, Routes } from "react-router-dom";

import { RequireAdmin, useAuth } from "./auth";
import AdminPage from "./routes/AdminPage";
import AgentPage from "./routes/AgentPage";
import LoginPage from "./routes/LoginPage";

function Header() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <nav className="topbar">
      <span className="muted">
        {user.name} · {user.role}
      </span>
      <span className="topbar-links">
        <Link to="/">Survey</Link>
        {user.role === "admin" && <Link to="/admin">Admin</Link>}
        <button className="link" onClick={logout}>
          Sign out
        </button>
      </span>
    </nav>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <LoginPage />;

  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<AgentPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
