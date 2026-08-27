import { useState } from "react";

import { useAuth } from "../auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await login(phone, password);
      setError(null);
    } catch {
      // The server deliberately does not say which half was wrong, and neither
      // does this: it would tell an attacker which phones are registered.
      setError("Phone or password is incorrect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>Sign in</h1>
        <p className="sub">Doctor chamber surveys</p>
      </header>

      {error && <div className="error">{error}</div>}

      <form className="card" onSubmit={onSubmit}>
        <label>
          Phone
          <input
            required
            autoFocus
            inputMode="tel"
            autoComplete="username"
            placeholder="01712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="muted">
        No account? An administrator creates it and gives you a password.
      </p>
    </main>
  );
}
