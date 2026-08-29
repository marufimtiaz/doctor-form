import { hospitalSchema, type HospitalForm } from "@/schemas/survey";

/** One key holds the whole session, so the doctor count cannot drift away
 *  from the hospital it belongs to. */
export const HOSPITAL_SESSION_KEY = "doctor-form:hospital-session";

export interface StoredSession {
  hospital: HospitalForm;
  doctorsAdded: number;
}

export function serializeSession(session: StoredSession): string {
  return JSON.stringify(session);
}

/** Anything unrecognisable is treated as "no session" rather than throwing.
 *  A bad entry written by an older build must never wedge an agent on a
 *  screen they cannot get past.
 *
 *  The hospital is validated against the full hospitalSchema, not just checked
 *  for shape. DoctorPage reassembles this half with the doctor half and parses
 *  the result with surveySchema, which throws rather than returning errors - so
 *  a session that survives this function has to be one that can actually be
 *  submitted. A stored hospital missing its phones would otherwise fail on
 *  every submit with nothing shown to the agent. */
export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const { hospital, doctorsAdded } = parsed as Partial<StoredSession>;

  if (!hospital || typeof hospital !== "object") return null;
  if (!hospitalSchema.safeParse(hospital).success) return null;

  return {
    hospital,
    doctorsAdded:
      typeof doctorsAdded === "number" && Number.isFinite(doctorsAdded) && doctorsAdded >= 0
        ? doctorsAdded
        : 0,
  };
}
