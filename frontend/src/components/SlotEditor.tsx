import type { Slot } from "../api";

// Displayed Saturday-first for Bangladesh; the values stay 0=Monday so the
// database never learns about display order.
const DAYS = [
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
];

export const emptySlot = (): Slot => ({
  day_of_week: 5,
  start_time: "17:00",
  end_time: "20:00",
});

export default function SlotEditor({
  slots,
  onChange,
}: {
  slots: Slot[];
  onChange: (slots: Slot[]) => void;
}) {
  const update = (i: number, patch: Partial<Slot>) =>
    onChange(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  return (
    <fieldset>
      <legend>Availability</legend>
      {slots.map((slot, i) => (
        <div key={i}>
          <div className="row">
            <select
              aria-label="Day"
              value={slot.day_of_week}
              onChange={(e) => update(i, { day_of_week: Number(e.target.value) })}
            >
              {DAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <input
              type="time"
              aria-label="Start time"
              required
              value={slot.start_time}
              onChange={(e) => update(i, { start_time: e.target.value })}
            />
            <input
              type="time"
              aria-label="End time"
              required
              value={slot.end_time}
              onChange={(e) => update(i, { end_time: e.target.value })}
            />
            {slots.length > 1 && (
              <button
                type="button"
                className="link"
                onClick={() => onChange(slots.filter((_, idx) => idx !== i))}
              >
                Remove
              </button>
            )}
          </div>
          {slot.end_time <= slot.start_time && (
            <p className="error">End must be after start</p>
          )}
        </div>
      ))}
      <button
        type="button"
        className="link"
        onClick={() => onChange([...slots, emptySlot()])}
      >
        Add slot
      </button>
    </fieldset>
  );
}
