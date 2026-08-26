import { Link, Navigate, Route, Routes } from "react-router-dom";

import { IdentityPicker, RequireAdmin, useIdentity } from "./auth";
import AdminPage from "./routes/AdminPage";
import AgentPage from "./routes/AgentPage";

function Header() {
  const { user, clear } = useIdentity();
  if (!user) return null;
  return (
    <nav className="topbar">
      <span className="muted">
        {user.name} · {user.role}
      </span>
      <span className="topbar-links">
        <Link to="/">Survey</Link>
        {user.role === "admin" && <Link to="/admin">Admin</Link>}
        <button className="link" onClick={clear}>
          Switch user
        </button>
      </span>
    </nav>
  );
}

export default function App() {
  const { user, loading } = useIdentity();

  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <IdentityPicker />;

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
