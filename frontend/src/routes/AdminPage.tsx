import { useCallback, useEffect, useState } from "react";

import {
  adminStats,
  createUser,
  deleteSurvey,
  listAllSurveys,
  listUsers,
  resetPassword,
  type AdminStats,
  type Survey,
  type UserPublic,
} from "../api";
import PasswordForm from "../components/PasswordForm";
import { describePlace, describeSlot } from "./AgentPage";

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [district, setDistrict] = useState("");
  const [agentId, setAgentId] = useState("");

  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [people, setPeople] = useState<UserPublic[]>([]);
  const [resetting, setResetting] = useState<UserPublic | null>(null);

  const refresh = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (district.trim()) params.district = district.trim();
      if (agentId) params.user_id = agentId;
      const [s, list, roster] = await Promise.all([
        adminStats(),
        listAllSurveys(params),
        listUsers(),
      ]);
      setStats(s);
      setSurveys(list);
      setPeople(roster);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [district, agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAddAgent(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createUser({
        name: newName,
        phone: newPhone,
        company: newCompany,
        role: "agent",
        password: newPassword,
      });
      setNewName("");
      setNewPhone("");
      setNewCompany("");
      setNewPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete(id: string) {
    // Soft on the server: the row and its nameplate survive for audit.
    if (!confirm("Remove this survey from the active list?")) return;
    try {
      await deleteSurvey(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const filtered = district.trim() !== "" || agentId !== "";

  return (
    <main className="wrap">
      <header>
        <h1>All surveys</h1>
      </header>

      {error && <div className="error">{error}</div>}

      {stats && (
        <section className="stats">
          <div className="card">
            <strong>{stats.total}</strong>
            <span className="muted">total surveys</span>
          </div>
          <div className="card">
            <strong>{stats.today}</strong>
            <span className="muted">today</span>
          </div>
          <div className="card">
            <strong>{stats.agent_count}</strong>
            <span className="muted">active users</span>
          </div>
        </section>
      )}

      {stats && stats.per_agent.length > 0 && (
        <section>
          <h2>By agent</h2>
          <ul className="list">
            {stats.per_agent.map((a) => (
              <li key={a.user_id} className="card row">
                <button className="link" onClick={() => setAgentId(a.user_id)}>
                  {a.name}
                </button>
                <span className="muted">
                  {a.today} today · {a.total} total
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Filters</h2>
        <div className="row">
          <input
            placeholder="District"
            aria-label="Filter by district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
          />
          {filtered && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setAgentId("");
                setDistrict("");
              }}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <form className="card" onSubmit={onAddAgent}>
        <h2>Add an agent</h2>
        <label>
          Name
          <input required value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label>
          Phone
          <input
            required
            placeholder="01712345678"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
          />
        </label>
        <label>
          Company
          <input
            required
            value={newCompany}
            onChange={(e) => setNewCompany(e.target.value)}
          />
        </label>
        <label>
          Initial password
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <p className="muted">
          Give this to the agent directly. They can change it from their own
          page.
        </p>
        <button type="submit">Create agent</button>
      </form>

      <section>
        <h2>People</h2>
        <ul className="list">
          {people.map((p) => (
            <li key={p.id} className="card">
              <div className="row">
                <span>
                  <strong>{p.name}</strong> · {p.company} · {p.role}
                  {!p.is_active && <span className="muted"> · deactivated</span>}
                </span>
                <button
                  className="link"
                  onClick={() => setResetting(resetting?.id === p.id ? null : p)}
                >
                  {resetting?.id === p.id ? "Cancel" : "Reset password"}
                </button>
              </div>
              {resetting?.id === p.id && (
                <PasswordForm
                  requireCurrent={false}
                  submitLabel={`Set a new password for ${p.name}`}
                  onSubmit={async (next) => {
                    // Signs them out of every device, which is the point.
                    await resetPassword(p.id, next);
                    setResetting(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Surveys</h2>
        {surveys.length === 0 ? (
          <p className="muted">Nothing matches.</p>
        ) : (
          <ul className="list">
            {surveys.map((s) => (
              <li key={s.id} className="card">
                <div className="row">
                  <strong>
                    {/* OCR has not run yet for anything filed by this system. */}
                    {s.doctor_name ?? "Dr. — (nameplate pending)"}
                  </strong>
                  <button className="link" onClick={() => void onDelete(s.id)}>
                    Delete
                  </button>
                </div>
                <div>{s.hospital_name}</div>
                <div className="muted">
                  filed by {s.agent_name ?? "unknown"} ·{" "}
                  {new Date(s.created_at).toLocaleString()}
                </div>
                <div className="muted">{describePlace(s)}</div>
                <div className="muted">{s.slots.map(describeSlot).join(" · ")}</div>
                <div className="muted">{s.phones.join(" · ")}</div>
                <div className="muted">
                  {s.daily_patients}/day · {s.avg_duration_min} min · ৳
                  {s.consultation_fee_bdt}
                </div>
                {s.nameplate_url && (
                  <a href={s.nameplate_url} target="_blank" rel="noreferrer">
                    View nameplate
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
