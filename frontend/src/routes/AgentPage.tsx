import { useCallback, useEffect, useState } from "react";

import {
  changePassword,
  createSurvey,
  listMySurveys,
  myStats,
  TOKEN_KEY,
  type Slot,
  type Stats,
  type Survey,
} from "../api";
import LocationInput, {
  emptyLocation,
  locationError,
  type LocationValue,
} from "../components/LocationInput";
import NameplateInput from "../components/NameplateInput";
import PasswordForm from "../components/PasswordForm";
import PhoneEditor from "../components/PhoneEditor";
import SlotEditor, { emptySlot } from "../components/SlotEditor";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function describeSlot(slot: Slot): string {
  return `${DAY_LABELS[slot.day_of_week]} ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;
}

export function describePlace(s: Survey): string {
  const parts: string[] = [];
  if (s.city && s.district) parts.push(`${s.city}, ${s.district}`);
  if (s.latitude !== null && s.longitude !== null) {
    parts.push(`(${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`);
  }
  return parts.join(" ");
}

export default function AgentPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, today: 0 });
  const [mine, setMine] = useState<Survey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [hospital, setHospital] = useState("");
  const [location, setLocation] = useState<LocationValue>(emptyLocation());
  const [slots, setSlots] = useState<Slot[]>([emptySlot()]);
  const [phones, setPhones] = useState<string[]>([""]);
  const [nameplate, setNameplate] = useState<File | null>(null);
  const [dailyPatients, setDailyPatients] = useState("");
  const [avgDuration, setAvgDuration] = useState("");
  const [fee, setFee] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([myStats(), listMySurveys()]);
      setStats(s);
      setMine(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function reset() {
    setHospital("");
    setLocation(emptyLocation());
    setSlots([emptySlot()]);
    setPhones([""]);
    setNameplate(null);
    setDailyPatients("");
    setAvgDuration("");
    setFee("");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const locError = locationError(location);
    if (locError) {
      setError(locError);
      return;
    }
    if (!nameplate) {
      setError("A nameplate photo is required.");
      return;
    }

    const form = new FormData();
    form.set("hospital_name", hospital);
    form.set("daily_patients", dailyPatients);
    form.set("avg_duration_min", avgDuration);
    form.set("consultation_fee_bdt", fee);
    // Multipart cannot nest, so these travel as JSON strings.
    form.set("slots", JSON.stringify(slots));
    form.set("phones", JSON.stringify(phones.filter((p) => p.trim() !== "")));
    form.set("nameplate", nameplate);
    if (location.city.trim()) form.set("city", location.city.trim());
    if (location.district.trim()) form.set("district", location.district.trim());
    if (location.latitude.trim()) form.set("latitude", location.latitude.trim());
    if (location.longitude.trim()) form.set("longitude", location.longitude.trim());

    setSaving(true);
    try {
      await createSurvey(form);
      reset();
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>New chamber survey</h1>
        <p className="sub">
          <strong>{stats.today}</strong> filed today · <strong>{stats.total}</strong>{" "}
          in total
        </p>
      </header>

      {error && <div className="error">{error}</div>}

      <form onSubmit={onSubmit} className="card">
        <label>
          Hospital name
          <input
            required
            maxLength={200}
            value={hospital}
            onChange={(e) => setHospital(e.target.value)}
          />
        </label>

        <LocationInput value={location} onChange={setLocation} />
        <NameplateInput file={nameplate} onChange={setNameplate} />
        <SlotEditor slots={slots} onChange={setSlots} />
        <PhoneEditor phones={phones} onChange={setPhones} />

        <label>
          Patients per day
          <input
            required
            type="number"
            min={1}
            value={dailyPatients}
            onChange={(e) => setDailyPatients(e.target.value)}
          />
        </label>
        <label>
          Average minutes per patient
          <input
            required
            type="number"
            min={1}
            value={avgDuration}
            onChange={(e) => setAvgDuration(e.target.value)}
          />
        </label>
        <label>
          Consultation fee (BDT)
          <input
            required
            type="number"
            min={0}
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </label>

        <button type="submit" disabled={saving}>
          {saving ? "Submitting…" : "Submit survey"}
        </button>
      </form>

      <section>
        <h2>My surveys</h2>
        {mine.length === 0 ? (
          <p className="muted">Nothing filed yet.</p>
        ) : (
          <ul className="list">
            {mine.map((s) => (
              <li key={s.id} className="card">
                <div className="row">
                  <strong>{s.hospital_name}</strong>
                  <time className="muted">
                    {new Date(s.created_at).toLocaleString()}
                  </time>
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

      <section>
        <h2>Account</h2>
        <PasswordForm
          requireCurrent
          submitLabel="Change password"
          onSubmit={async (next, current) => {
            const resp = await changePassword(current, next);
            // The change bumps token_version, so the token we hold is now dead.
            // Storing the replacement keeps this session alive while every
            // other device is signed out.
            localStorage.setItem(TOKEN_KEY, resp.access_token);
          }}
        />
      </section>
    </main>
  );
}
