import { describe, expect, it } from "vitest";

import {
  EVENING_CHAMBER,
  MORNING_CHAMBER,
  TIMELINE_END_MINS,
  TIMELINE_START_MINS,
  TIME_OPTIONS,
  findOverlaps,
  sortRanges,
  suggestSecondShift,
  type TimeRange,
} from "@/lib/shifts";

const R = (start_time: string, end_time: string): TimeRange => ({
  start_time,
  end_time,
});

const toMins = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const indexToTime = (i: number) => {
  const mins = TIMELINE_START_MINS + i * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(
    mins % 60,
  ).padStart(2, "0")}`;
};

const TOTAL_SLOTS = (TIMELINE_END_MINS - TIMELINE_START_MINS) / 30;

/** Every range expressible on the timeline. */
function everySingleRange(): TimeRange[][] {
  const out: TimeRange[][] = [];
  for (let a = 0; a < TOTAL_SLOTS; a++) {
    for (let b = a + 1; b <= TOTAL_SLOTS; b++) {
      out.push([R(indexToTime(a), indexToTime(b))]);
    }
  }
  return out;
}

describe("TIME_OPTIONS", () => {
  it("starts at the timeline start so every option is drawable", () => {
    expect(TIME_OPTIONS[0].value).toBe("08:00");
  });

  it("ends at midnight", () => {
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1].value).toBe("24:00");
  });

  it("offers no time the timeline cannot draw", () => {
    for (const option of TIME_OPTIONS) {
      expect(toMins(option.value)).toBeGreaterThanOrEqual(TIMELINE_START_MINS);
      expect(toMins(option.value)).toBeLessThanOrEqual(TIMELINE_END_MINS);
    }
  });
});

describe("suggestSecondShift", () => {
  it("suggests the morning chamber alongside an evening shift", () => {
    expect(suggestSecondShift([EVENING_CHAMBER])).toEqual(MORNING_CHAMBER);
  });

  it("suggests the evening chamber alongside a morning shift", () => {
    expect(suggestSecondShift([MORNING_CHAMBER])).toEqual(EVENING_CHAMBER);
  });

  it("never suggests a range overlapping an existing one", () => {
    // Regression: the old farthest-free-slot search picked a start slot and
    // then added a fixed hour, so 08:30-24:00 produced an overlapping
    // 08:00-09:00 while the button still looked enabled.
    const existing = [R("08:30", "24:00")];
    const suggestion = suggestSecondShift(existing);
    if (suggestion) {
      expect(findOverlaps(sortRanges([...existing, suggestion]))).toEqual([]);
    }
  });

  it("returns null when the day is fully occupied", () => {
    expect(suggestSecondShift([R("08:00", "24:00")])).toBeNull();
  });

  it("falls back to the largest free gap when both chambers are blocked", () => {
    expect(suggestSecondShift([R("08:00", "21:00")])).toEqual(R("21:00", "24:00"));
  });

  it("produces no overlap for any single existing range", () => {
    const offenders: string[] = [];
    for (const existing of everySingleRange()) {
      const suggestion = suggestSecondShift(existing);
      if (!suggestion) continue;
      const overlaps = findOverlaps(sortRanges([...existing, suggestion]));
      if (overlaps.length > 0) {
        offenders.push(
          `${existing[0].start_time}-${existing[0].end_time} -> ${suggestion.start_time}-${suggestion.end_time}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("always suggests a positive-length range inside the timeline", () => {
    for (const existing of everySingleRange()) {
      const suggestion = suggestSecondShift(existing);
      if (!suggestion) continue;
      expect(toMins(suggestion.end_time)).toBeGreaterThan(
        toMins(suggestion.start_time),
      );
      expect(toMins(suggestion.start_time)).toBeGreaterThanOrEqual(
        TIMELINE_START_MINS,
      );
      expect(toMins(suggestion.end_time)).toBeLessThanOrEqual(TIMELINE_END_MINS);
    }
  });

  it("never suggests a shift shorter than 30 minutes", () => {
    for (const existing of everySingleRange()) {
      const suggestion = suggestSecondShift(existing);
      if (!suggestion) continue;
      const mins = toMins(suggestion.end_time) - toMins(suggestion.start_time);
      expect(mins).toBeGreaterThanOrEqual(30);
    }
  });

  it("produces no overlap for any pair of existing ranges", () => {
    const offenders: string[] = [];
    for (let a = 0; a < TOTAL_SLOTS; a += 3) {
      for (let b = a + 1; b <= TOTAL_SLOTS; b += 3) {
        for (let c = b; c < TOTAL_SLOTS; c += 3) {
          for (let d = c + 1; d <= TOTAL_SLOTS; d += 3) {
            const existing = [
              R(indexToTime(a), indexToTime(b)),
              R(indexToTime(c), indexToTime(d)),
            ];
            if (findOverlaps(existing).length > 0) continue;
            const suggestion = suggestSecondShift(existing);
            if (!suggestion) continue;
            if (findOverlaps(sortRanges([...existing, suggestion])).length > 0) {
              offenders.push(
                `${existing.map((r) => `${r.start_time}-${r.end_time}`).join(",")} -> ${suggestion.start_time}-${suggestion.end_time}`,
              );
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
