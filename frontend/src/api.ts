export interface UserPublic {
  id: string;
  name: string;
  company: string;
  role: "agent" | "admin";
  is_active: boolean;
}

export interface Slot {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface Survey {
  id: string;
  user_id: string;
  hospital_name: string;
  city: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  nameplate_key: string;
  nameplate_url: string | null;
  daily_patients: number;
  avg_duration_min: number;
  consultation_fee_bdt: number;
  ocr_status: "pending" | "done" | "failed";
  doctor_name: string | null;
  doctor_degrees: string | null;
  doctor_specializations: string | null;
  created_at: string;
  deleted_at: string | null;
  slots: Slot[];
  phones: string[];
  agent_name: string | null;
}

export interface Stats {
  total: number;
  today: number;
}

export interface AgentStat {
  user_id: string;
  name: string;
  total: number;
  today: number;
}

export interface AdminStats extends Stats {
  agent_count: number;
  per_agent: AgentStat[];
}

// Same-origin by default: Vite proxies /api in dev, Caddy proxies it in prod.
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export const TOKEN_KEY = "doctor-form.token";

/** Called whenever the server rejects our credentials. Set by AuthProvider so
 *  expiry, deactivation and password changes all land in one place. */
let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The single place the identity header is attached. When real login lands,
 *  this becomes an Authorization: Bearer header and nothing else changes. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const resp = await fetch(`${BASE}${path}`, { ...init, headers });

  if (resp.status === 401) {
    // One place covers an expired token, a deactivated account, and a password
    // changed on another device - all of which arrive as a 401.
    localStorage.removeItem(TOKEN_KEY);
    onUnauthorized();
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new ApiError(resp.status, `${resp.status}: ${detail}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const listUsers = () => request<UserPublic[]>("/api/users");

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserPublic;
}

export const login = (phone: string, password: string) =>
  request<TokenResponse>("/api/auth/login", json({ phone, password }));

export const me = () => request<UserPublic>("/api/auth/me");

export const changePassword = (current_password: string, new_password: string) =>
  request<TokenResponse>(
    "/api/auth/change-password",
    json({ current_password, new_password }),
  );

export const resetPassword = (userId: string, password: string) =>
  request<void>(`/api/users/${userId}/reset-password`, json({ password }));

export const createUser = (body: {
  name: string;
  phone: string;
  company: string;
  role: "agent" | "admin";
  password: string;
}) => request<UserPublic>("/api/users", json(body));

export const listMySurveys = () => request<Survey[]>("/api/surveys");

export const myStats = () => request<Stats>("/api/surveys/stats");

export const createSurvey = (form: FormData) =>
  request<Survey>("/api/surveys", { method: "POST", body: form });

export const listAllSurveys = (params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request<Survey[]>(`/api/admin/surveys${qs ? `?${qs}` : ""}`);
};

export const adminStats = () => request<AdminStats>("/api/admin/stats");

export const deleteSurvey = (id: string) =>
  request<void>(`/api/admin/surveys/${id}`, { method: "DELETE" });
