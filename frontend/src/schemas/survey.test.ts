import { describe, expect, it } from "vitest";

import { emptySlot, surveySchema } from "./survey";

/** A valid form, minus location - each test supplies its own. */
const base = {
  hospital_name: "Square Hospital",
  latitude: "",
  longitude: "",
  city: "",
  district: "",
  daily_patients: "30",
  avg_duration_min: "10",
  consultation_fee_bdt: "1200",
  slots: [emptySlot()],
  phones: [{ value: "01712345678" }],
};

const parse = (overrides: Record<string, unknown> = {}) =>
  surveySchema.safeParse({ ...base, ...overrides });

const messages = (result: ReturnType<typeof parse>) =>
  result.success ? [] : result.error.issues.map((i) => i.message);

describe("location", () => {
  it("accepts coordinates alone", () => {
    expect(parse({ latitude: "23.75", longitude: "90.39" }).success).toBe(true);
  });

  it("accepts city and district alone", () => {
    expect(parse({ city: "Dhaka", district: "Dhanmondi" }).success).toBe(true);
  });

  it("accepts both pairs together", () => {
    const result = parse({
      latitude: "23.75",
      longitude: "90.39",
      city: "Dhaka",
      district: "Dhanmondi",
    });
    expect(result.success).toBe(true);
  });

  it("rejects neither pair", () => {
    expect(messages(parse())).toContain("Provide coordinates or city and district.");
  });

  it("rejects half a coordinate pair", () => {
    expect(messages(parse({ latitude: "23.75" }))).toContain(
      "Give both latitude and longitude, or neither.",
    );
  });

  it("rejects half a place pair", () => {
    expect(messages(parse({ city: "Dhaka" }))).toContain(
      "Give both city and district, or neither.",
    );
  });

  it("does not let whitespace satisfy the requirement", () => {
    expect(parse({ city: "   ", district: "   " }).success).toBe(false);
  });

  it("rejects an out-of-range latitude", () => {
    expect(parse({ latitude: "120", longitude: "90.39" }).success).toBe(false);
  });
});

describe("slots", () => {
  const withCity = { city: "Dhaka", district: "Dhanmondi" };

  it("requires at least one", () => {
    expect(parse({ ...withCity, slots: [] }).success).toBe(false);
  });

  it("rejects an end at or before the start", () => {
    const slots = [{ day_of_week: 5, start_time: "20:00", end_time: "17:00" }];
    expect(messages(parse({ ...withCity, slots }))).toContain(
      "End must be after start.",
    );
  });

  it("rejects a day outside 0-6", () => {
    const slots = [{ day_of_week: 7, start_time: "17:00", end_time: "20:00" }];
    expect(parse({ ...withCity, slots }).success).toBe(false);
  });
});

describe("phones and numbers", () => {
  const withCity = { city: "Dhaka", district: "Dhanmondi" };

  it("requires at least one phone", () => {
    expect(parse({ ...withCity, phones: [] }).success).toBe(false);
  });

  it("rejects a blank phone", () => {
    expect(parse({ ...withCity, phones: [{ value: "  " }] }).success).toBe(false);
  });

  it("rejects zero patients per day", () => {
    expect(parse({ ...withCity, daily_patients: "0" }).success).toBe(false);
  });

  it("rejects a negative fee", () => {
    expect(parse({ ...withCity, consultation_fee_bdt: "-1" }).success).toBe(false);
  });

  it("allows a free consultation", () => {
    expect(parse({ ...withCity, consultation_fee_bdt: "0" }).success).toBe(true);
  });

  it("coerces numeric strings from the inputs", () => {
    const result = parse(withCity);
    expect(result.success && result.data.daily_patients).toBe(30);
  });
});
