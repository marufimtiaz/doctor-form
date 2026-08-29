import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  HOSPITAL_SESSION_KEY,
  parseStoredSession,
  serializeSession,
  type StoredSession,
} from "@/lib/hospitalSession";
import type { HospitalForm } from "@/schemas/survey";

interface HospitalSession {
  hospital: HospitalForm | null;
  doctorsAdded: number;
  startHospital: (draft: HospitalForm) => void;
  recordDoctor: () => void;
  exitHospital: () => void;
}

const HospitalContext = createContext<HospitalSession | null>(null);

// Storage access is wrapped: a browser in private mode, or with site data
// blocked, throws on access rather than returning null. The session then lives
// in memory for the tab, which still gets the agent through one hospital.
function readSession(): StoredSession | null {
  try {
    return parseStoredSession(localStorage.getItem(HOSPITAL_SESSION_KEY));
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null): void {
  try {
    if (session) {
      localStorage.setItem(HOSPITAL_SESSION_KEY, serializeSession(session));
    } else {
      localStorage.removeItem(HOSPITAL_SESSION_KEY);
    }
  } catch {
    // Storage unavailable; in-memory state is still correct.
  }
}

export function HospitalProvider({ children }: { children: ReactNode }) {
  // Lazy initializer, so the very first render already has the restored
  // session and the /doctors guard never flashes a redirect.
  const [session, setSession] = useState<StoredSession | null>(readSession);

  const startHospital = useCallback((draft: HospitalForm) => {
    const next: StoredSession = { hospital: draft, doctorsAdded: 0 };
    setSession(next);
    writeSession(next);
  }, []);

  const recordDoctor = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, doctorsAdded: prev.doctorsAdded + 1 };
      writeSession(next);
      return next;
    });
  }, []);

  const exitHospital = useCallback(() => {
    setSession(null);
    writeSession(null);
  }, []);

  const value = useMemo(
    () => ({
      hospital: session?.hospital ?? null,
      doctorsAdded: session?.doctorsAdded ?? 0,
      startHospital,
      recordDoctor,
      exitHospital,
    }),
    [session, startHospital, recordDoctor, exitHospital],
  );

  return (
    <HospitalContext.Provider value={value}>{children}</HospitalContext.Provider>
  );
}

export function useHospital(): HospitalSession {
  const ctx = useContext(HospitalContext);
  if (!ctx) throw new Error("useHospital must be used inside HospitalProvider");
  return ctx;
}
