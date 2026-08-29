import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

  // Persisting here rather than inside the setters keeps the state updaters
  // pure - React double-invokes them in StrictMode, and an updater that writes
  // to storage is a side effect waiting to bite whoever edits it next.
  useEffect(() => {
    writeSession(session);
  }, [session]);

  const startHospital = useCallback((draft: HospitalForm) => {
    setSession({ hospital: draft, doctorsAdded: 0 });
  }, []);

  const recordDoctor = useCallback(() => {
    setSession((prev) =>
      prev ? { ...prev, doctorsAdded: prev.doctorsAdded + 1 } : prev,
    );
  }, []);

  const exitHospital = useCallback(() => {
    setSession(null);
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
