import { useCallback, useEffect, useRef, useState } from "react";

import {
  createSubmission,
  deleteSubmission,
  listSubmissions,
  type Submission,
} from "./api";

export default function App() {
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listSubmissions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await createSubmission(new FormData(event.currentTarget));
      formRef.current?.reset();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteSubmission(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>Doctor Form</h1>
        <p className="sub">Vite + FastAPI + SQLite + RustFS scaffold</p>
      </header>

      {error && <div className="error">{error}</div>}

      <form ref={formRef} onSubmit={onSubmit} className="card">
        <label>
          Patient name
          <input name="patient_name" required maxLength={200} />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Notes
          <textarea name="notes" rows={3} maxLength={5000} />
        </label>
        <label>
          Attachment
          <input name="attachment" type="file" />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? "Submitting…" : "Submit"}
        </button>
      </form>

      <section>
        <h2>Submissions</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">Nothing submitted yet.</p>
        ) : (
          <ul className="list">
            {items.map((item) => (
              <li key={item.id} className="card">
                <div className="row">
                  <strong>{item.patient_name}</strong>
                  <button className="link" onClick={() => void onDelete(item.id)}>
                    Delete
                  </button>
                </div>
                <div className="muted">{item.email}</div>
                {item.notes && <p>{item.notes}</p>}
                {item.attachment_url && (
                  <a href={item.attachment_url} target="_blank" rel="noreferrer">
                    View attachment
                  </a>
                )}
                <time className="muted">
                  {new Date(item.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
