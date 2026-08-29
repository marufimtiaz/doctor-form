/** Pure timeline maths for the availability editor.
 *
 * These live outside SlotEditor so they can be tested directly - the project
 * has no DOM tests by design (see vitest.config.ts), so any logic that needs
 * proving has to be reachable without rendering a component.
 */

export interface TimeRange {
  start_time: string;
  end_time: string;
}

export const TIMELINE_START_MINS = 8 * 60; // 8 AM
export const TIMELINE_END_MINS = 24 * 60; // 12 AM Midnight
const TOTAL_TIMELINE_MINS = TIMELINE_END_MINS - TIMELINE_START_MINS;
const SLOT_MINS = 30;
const TOTAL_SLOTS = TOTAL_TIMELINE_MINS / SLOT_MINS;
/** Length of a suggested shift when it is not constrained by a smaller gap. */
const DEFAULT_SHIFT_MINS = 3 * 60;

function timeToMins(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minsToTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(
    mins % 60,
  ).padStart(2, "0")}`;
}

/** The earliest selectable time. Derived from the timeline rather than written
 *  out, so the dropdown can never offer a time the track cannot draw. */
export const TIMELINE_START_TIME = minsToTime(TIMELINE_START_MINS);

// 30-minute interval options spanning exactly the drawable timeline.
export const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let hour = TIMELINE_START_MINS / 60; hour <= TIMELINE_END_MINS / 60; hour++) {
  for (const min of [0, 30]) {
    if (hour === 24 && min === 30) continue;
    const hh = String(hour).padStart(2, "0");
    const mm = String(min).padStart(2, "0");
    const value = `${hh}:${mm}`;
    let label: string;
    if (hour === 24 || (hour === 0 && min === 0)) {
      label = "12:00 AM (Midnight)";
    } else {
      const period = hour >= 12 && hour < 24 ? "PM" : "AM";
      const displayHour = hour % 12 === 0 ? 12 : hour % 12;
      label = `${String(displayHour).padStart(2, "0")}:${mm} ${period}`;
    }
    TIME_OPTIONS.push({ value, label });
  }
}

export function timeToPercent(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  const mins = h * 60 + m;
  const clamped = Math.max(TIMELINE_START_MINS, Math.min(TIMELINE_END_MINS, mins));
  return ((clamped - TIMELINE_START_MINS) / TOTAL_TIMELINE_MINS) * 100;
}

export function percentToTime(percent: number): string {
  const clampedPct = Math.max(0, Math.min(100, percent));
  const rawMins = TIMELINE_START_MINS + (clampedPct / 100) * TOTAL_TIMELINE_MINS;
  const snappedMins = Math.round(rawMins / 30) * 30;
  const clampedMins = Math.max(TIMELINE_START_MINS, Math.min(TIMELINE_END_MINS, snappedMins));
  const h = String(Math.floor(clampedMins / 60)).padStart(2, "0");
  const m = String(clampedMins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export function sortRanges(ranges: Array<{ start_time: string; end_time: string }>) {
  return [...ranges].sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export function findOverlaps(ranges: Array<{ start_time: string; end_time: string }>) {
  const overlaps: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const r1 = ranges[i];
      const r2 = ranges[j];
      if (!r1.start_time || !r1.end_time || !r2.start_time || !r2.end_time) continue;
      const startMax = r1.start_time > r2.start_time ? r1.start_time : r2.start_time;
      const endMin = r1.end_time < r2.end_time ? r1.end_time : r2.end_time;
      if (startMax < endMin) {
        overlaps.push(`Shift ${i + 1} and Shift ${j + 1} overlap (${startMax} – ${endMin})`);
      }
    }
  }
  return overlaps;
}

// Strictly filter dropdown options based on adjacent shift boundaries
export function getFilteredTimeOptions(
  field: "start_time" | "end_time",
  rangeIndex: number,
  ranges: Array<{ start_time: string; end_time: string }>,
) {
  const range = ranges[rangeIndex];
  if (!range) return TIME_OPTIONS;

  if (rangeIndex === 0) {
    // Shift 1
    const nextShift = ranges[1];
    const maxBound = nextShift?.start_time || "24:00";

    if (field === "start_time") {
      // Must be < end_time and < maxBound
      const upper = range.end_time && range.end_time < maxBound ? range.end_time : maxBound;
      return TIME_OPTIONS.filter((t) => t.value < upper);
    } else {
      // end_time: Must be > start_time and <= maxBound
      const lower = range.start_time || TIMELINE_START_TIME;
      return TIME_OPTIONS.filter((t) => t.value > lower && t.value <= maxBound);
    }
  } else {
    // Shift 2
    const prevShift = ranges[0];
    const minBound = prevShift?.end_time || TIMELINE_START_TIME;

    if (field === "start_time") {
      // Must be >= minBound and < end_time
      const upper = range.end_time || "24:00";
      return TIME_OPTIONS.filter((t) => t.value >= minBound && t.value < upper);
    } else {
      // end_time: Must be > start_time
      const lower = range.start_time || minBound;
      return TIME_OPTIONS.filter((t) => t.value > lower);
    }
  }
}

/** The two chamber slots a doctor most commonly runs. */
export const MORNING_CHAMBER: TimeRange = { start_time: "09:00", end_time: "12:00" };
export const EVENING_CHAMBER: TimeRange = { start_time: "17:00", end_time: "20:00" };

/** Slot-granularity occupancy map of the drawable timeline. */
function occupancy(ranges: TimeRange[]): boolean[] {
  const occupied: boolean[] = new Array(TOTAL_SLOTS).fill(false);
  for (const range of ranges) {
    if (!range.start_time || !range.end_time) continue;
    const startMins = timeToMins(range.start_time);
    const endMins = timeToMins(range.end_time);
    if (endMins <= startMins) continue;
    const from = Math.max(
      0,
      Math.floor((startMins - TIMELINE_START_MINS) / SLOT_MINS),
    );
    const to = Math.min(
      TOTAL_SLOTS,
      Math.ceil((endMins - TIMELINE_START_MINS) / SLOT_MINS),
    );
    for (let i = from; i < to; i++) occupied[i] = true;
  }
  return occupied;
}

function isFree(range: TimeRange, occupied: boolean[]): boolean {
  const from = Math.floor(
    (timeToMins(range.start_time) - TIMELINE_START_MINS) / SLOT_MINS,
  );
  const to = Math.ceil(
    (timeToMins(range.end_time) - TIMELINE_START_MINS) / SLOT_MINS,
  );
  if (from < 0 || to > TOTAL_SLOTS) return false;
  for (let i = from; i < to; i++) if (occupied[i]) return false;
  return true;
}

/** Suggests where a second shift should go for a group that already has one.
 *
 * Doctors typically run a morning and an evening chamber, so the suggestion
 * is the complement of what is already scheduled. The previous version searched
 * for the free slot farthest from any occupied one, which is a maximin that
 * always resolves to an end of the timeline - every suggestion came out flush
 * against 08:00 or midnight, and half of them were a 30-minute sliver ending at
 * 24:00. It also picked a start slot and then added a fixed hour without
 * checking the gap was an hour wide, so it could propose an overlapping range.
 *
 * Here the range is always built to fit inside a gap that is known to be free,
 * so an overlapping suggestion is not representable.
 */
export function suggestSecondShift(ranges: TimeRange[]): TimeRange | null {
  const occupied = occupancy(ranges);

  const midpoints = ranges
    .filter((r) => r.start_time && r.end_time)
    .map((r) => (timeToMins(r.start_time) + timeToMins(r.end_time)) / 2);
  const centre = midpoints.length
    ? midpoints.reduce((a, b) => a + b, 0) / midpoints.length
    : 0;
  const preferred =
    centre >= 12 * 60
      ? [MORNING_CHAMBER, EVENING_CHAMBER]
      : [EVENING_CHAMBER, MORNING_CHAMBER];
  for (const chamber of preferred) {
    if (isFree(chamber, occupied)) return chamber;
  }

  // Both chambers are taken, so fall back to the widest free gap.
  let widestFrom = -1;
  let widestSlots = 0;
  let from = -1;
  for (let i = 0; i <= TOTAL_SLOTS; i++) {
    const free = i < TOTAL_SLOTS && !occupied[i];
    if (free && from === -1) from = i;
    if (!free && from !== -1) {
      if (i - from > widestSlots) {
        widestSlots = i - from;
        widestFrom = from;
      }
      from = -1;
    }
  }
  if (widestSlots === 0) return null;

  const startMins = TIMELINE_START_MINS + widestFrom * SLOT_MINS;
  const gapMins = widestSlots * SLOT_MINS;
  return {
    start_time: minsToTime(startMins),
    end_time: minsToTime(startMins + Math.min(gapMins, DEFAULT_SHIFT_MINS)),
  };
}
