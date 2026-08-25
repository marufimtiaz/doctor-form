export interface Submission {
  id: string;
  patient_name: string;
  email: string;
  notes: string;
  attachment_key: string | null;
  attachment_url: string | null;
  created_at: string;
}

// Same-origin by default: Vite proxies /api in dev, Caddy proxies it in prod.
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function handle<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new Error(`${resp.status}: ${detail}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export function listSubmissions(): Promise<Submission[]> {
  return fetch(`${BASE}/api/submissions`).then(handle<Submission[]>);
}

export function createSubmission(form: FormData): Promise<Submission> {
  return fetch(`${BASE}/api/submissions`, { method: "POST", body: form }).then(
    handle<Submission>,
  );
}

export function deleteSubmission(id: string): Promise<void> {
  return fetch(`${BASE}/api/submissions/${id}`, { method: "DELETE" }).then(
    handle<void>,
  );
}
