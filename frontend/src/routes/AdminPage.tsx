import { useCallback, useEffect, useState } from "react";

import {
  adminStats,
  createUser,
  deleteSurvey,
  listAllSurveys,
  type AdminStats,
  type Survey,
} from "../api";
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

  const refresh = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (district.trim()) params.district = district.trim();
      if (agentId) params.user_id = agentId;
      const [s, list] = await Promise.all([adminStats(), listAllSurveys(params)]);
      setStats(s);
      setSurveys(list);
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
      });
      setNewName("");
      setNewPhone("");
      setNewCompany("");
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
        <button type="submit">Create agent</button>
      </form>

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
