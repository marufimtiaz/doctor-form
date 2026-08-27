import { useState } from "react";

export const PASSWORD_MIN = 8;

/** Used both for changing your own password and for an admin resetting
 *  someone else's, which differ only in whether a current password is asked
 *  for. */
export default function PasswordForm({
  requireCurrent,
  submitLabel,
  onSubmit,
}: {
  requireCurrent: boolean;
  submitLabel: string;
  onSubmit: (next: string, current: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(next, current);
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDone(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      {error && <div className="error">{error}</div>}
      {done && <p className="muted">Password updated.</p>}
      {requireCurrent && (
        <label>
          Current password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
      )}
      <label>
        New password
        <input
          required
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
          required
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
