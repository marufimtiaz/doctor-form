import { describe, expect, it } from "vitest";

import {
  doctorSchema,
  emptyDoctorValues,
  emptyHospitalValues,
  emptySlot,
  emptySurveyValues,
  hospitalSchema,
  surveySchema,
  toBackendSlots,
} from "./survey";

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

  it("requires at least one slot group", () => {
    expect(parse({ ...withCity, slots: [] }).success).toBe(false);
  });

  it("requires at least one day and one range per slot group", () => {
    const slots = [{ days: [], ranges: [] }];
    expect(parse({ ...withCity, slots }).success).toBe(false);
  });

  it("flattens multi-day and multi-range slot groups into backend integer slot items", () => {
    const slots = [
      {
        days: ["Sat", "Sun"],
        ranges: [
          { start_time: "09:00", end_time: "12:00" },
          { start_time: "17:00", end_time: "20:00" },
        ],
      },
    ];
    const result = parse({ ...withCity, slots });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(toBackendSlots(result.data.slots)).toEqual([
        { day_of_week: 5, start_time: "09:00", end_time: "12:00" },
        { day_of_week: 5, start_time: "17:00", end_time: "20:00" },
        { day_of_week: 6, start_time: "09:00", end_time: "12:00" },
        { day_of_week: 6, start_time: "17:00", end_time: "20:00" },
      ]);
    }
  });

  it("rejects an end time at or before the start time in any range", () => {
    const slots = [
      {
        days: ["Sat"],
        ranges: [{ start_time: "20:00", end_time: "17:00" }],
      },
    ];
    expect(messages(parse({ ...withCity, slots }))).toContain(
      "End must be after start.",
    );
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

describe("schema split", () => {
  const hospital = {
    hospital_name: "Square Hospital",
    has_emergency_service: false,
    city: "Dhaka",
    district: "Dhaka",
    latitude: "",
    longitude: "",
    phones: [{ value: "01712345678" }],
  };
  const doctor = {
    phones: [{ value: "01712345678" }],
    daily_patients: "30",
    avg_duration_min: "10",
    consultation_fee_bdt: "800",
    slots: [emptySlot()],
  };

  it("composes into a value surveySchema accepts", () => {
    expect(surveySchema.safeParse({ ...hospital, ...doctor }).success).toBe(true);
  });

  it("accepts the hospital half on its own", () => {
    expect(hospitalSchema.safeParse(hospital).success).toBe(true);
  });

  it("accepts the doctor half on its own", () => {
    expect(doctorSchema.safeParse(doctor).success).toBe(true);
  });

  it("still rejects half a coordinate pair from hospitalSchema", () => {
    const bad = { ...hospital, city: "", district: "", latitude: "23.8" };
    expect(hospitalSchema.safeParse(bad).success).toBe(false);
  });

  it("still rejects city without district from hospitalSchema", () => {
    const bad = { ...hospital, district: "" };
    expect(hospitalSchema.safeParse(bad).success).toBe(false);
  });

  it("allows the hospital half to carry no common number", () => {
    expect(hospitalSchema.safeParse({ ...hospital, phones: [] }).success).toBe(true);
  });

  it("drops blank rows from the hospital's common numbers", () => {
    const parsed = hospitalSchema.parse({ ...hospital, phones: [{ value: "  " }] });
    expect(parsed.phones).toEqual([]);
  });

  it("requires at least one phone on the doctor half", () => {
    expect(doctorSchema.safeParse({ ...doctor, phones: [] }).success).toBe(false);
  });

  it("requires at least one slot group on the doctor half", () => {
    expect(doctorSchema.safeParse({ ...doctor, slots: [] }).success).toBe(false);
  });

  it("rejects zero patients per day on the doctor half", () => {
    expect(doctorSchema.safeParse({ ...doctor, daily_patients: "0" }).success).toBe(false);
  });

  it("accepts a doctor with no nameplate fields read", () => {
    const parsed = doctorSchema.parse(doctor);
    expect(parsed.doctor_name).toBe("");
    expect(parsed.doctor_degrees).toBe("");
    expect(parsed.doctor_specializations).toBe("");
  });

  it("keeps the fields the agent approved", () => {
    const parsed = doctorSchema.parse({
      ...doctor,
      doctor_name: "  Rahman  ",
      doctor_specializations: "Cardiology",
    });
    expect(parsed.doctor_name).toBe("Rahman");
    expect(parsed.doctor_specializations).toBe("Cardiology");
  });

  it("rejects a doctor name longer than the column allows", () => {
    const bad = { ...doctor, doctor_name: "x".repeat(201) };
    expect(doctorSchema.safeParse(bad).success).toBe(false);
  });

  it("builds empty values that compose back into surveySchema shape", () => {
    const composed = { ...emptyHospitalValues(), ...emptyDoctorValues() };
    expect(composed).toEqual(emptySurveyValues());
  });
});
