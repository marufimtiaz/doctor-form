import { z } from "zod";

import { EVENING_CHAMBER } from "@/lib/shifts";

/** Text inputs give strings; the API wants numbers. Coercing here keeps the
 *  form fields plain and the parsed output correctly typed. */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const numeric = (
  message: string,
  configure?: (schema: z.ZodNumber) => z.ZodNumber,
) => {
  let num = z.coerce.number({ invalid_type_error: message });
  if (configure) num = configure(num);
  return z.preprocess(blankToUndefined, num);
};

export const DAY_NAMES = [
  "Sat",
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
] as const;
export type DayName = (typeof DAY_NAMES)[number];

export const DAY_NAME_TO_INT: Record<DayName, number> = {
  Sat: 5,
  Sun: 6,
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
};

export const timeRangeSchema = z
  .object({
    start_time: z.string().min(1, "Start time is required."),
    end_time: z.string().min(1, "End time is required."),
  })
  .refine((range) => range.end_time > range.start_time, {
    message: "End must be after start.",
    path: ["end_time"],
  });

export const slotSchema = z.object({
  days: z.array(z.enum(DAY_NAMES)).min(1, "Select at least one day."),
  ranges: z.array(timeRangeSchema).min(1, "Add at least one time range."),
});

const locationRule = (
  v: { latitude: string; district: string; city: string; longitude: string },
  ctx: z.RefinementCtx,
) => {
  // Mirrors ck_surveys_location and the backend's SurveyCreate validator:
  // either precise coordinates or a named place, each all-or-nothing.
  const hasLat = v.latitude.trim() !== "";
  const hasLng = v.longitude.trim() !== "";
  const hasCity = v.city.trim() !== "";
  const hasDistrict = v.district.trim() !== "";

  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["longitude"],
      message: "Give both latitude and longitude, or neither.",
    });
  }
  if (hasCity !== hasDistrict) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["district"],
      message: "Give both city and district, or neither.",
    });
  }
  if (!hasLat && !hasCity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["city"],
      message: "Provide coordinates or city and district.",
    });
  }
};

// Shapes rather than finished schemas: z.object().superRefine() returns a
// ZodEffects, which cannot be merged, so the combined schema has to be built
// from the raw shapes.
const hospitalShape = {
  hospital_name: z.string().trim().min(1, "Hospital name is required.").max(200),
  has_emergency_service: z.boolean().default(false),

  city: z.string().max(100).default(""),
  district: z.string().max(100).default(""),
  latitude: z
    .string()
    .default("")
    .refine(
      (v) => v.trim() === "" || (Number(v) >= -90 && Number(v) <= 90),
      "Latitude must be between -90 and 90.",
    ),
  longitude: z
    .string()
    .default("")
    .refine(
      (v) => v.trim() === "" || (Number(v) >= -180 && Number(v) <= 180),
      "Longitude must be between -180 and 180.",
    ),

  // Optional: only for a hospital where every doctor is booked through one
  // common line. Blank rows are dropped rather than rejected, so an agent who
  // opens the field and changes their mind is not blocked by it.
  // useFieldArray needs objects, not bare strings.
  phones: z
    .array(z.object({ value: z.string().trim() }))
    .default([])
    .transform((list) => list.filter((p) => p.value !== "")),
};

const doctorShape = {
  // Required here rather than on the hospital: a doctor has to be reachable,
  // whether by the hospital's common line (pre-filled from it) or their own.
  // surveySchema spreads doctorShape last, so this is the rule that governs
  // what actually reaches the API - which requires at least one number.
  phones: z
    .array(z.object({ value: z.string().trim().min(1, "Enter a number.") }))
    .min(1, "Add at least one phone number."),

  daily_patients: numeric("Enter a number.", (n) =>
    n.int().positive("Must be more than zero."),
  ),
  avg_duration_min: numeric("Enter a number.", (n) =>
    n.int().positive("Must be more than zero."),
  ),
  consultation_fee_bdt: numeric("Enter a number.", (n) =>
    n.int().min(0, "Cannot be negative."),
  ),

  slots: z.array(slotSchema).min(1, "Add at least one availability slot."),

  // Read from the nameplate on upload and editable by the agent. Blank means
  // no preview ran, which leaves the row to the background worker.
  doctor_name: z.string().trim().max(200).default(""),
  doctor_degrees: z.string().trim().max(1000).default(""),
  doctor_specializations: z.string().trim().max(1000).default(""),
};

export const hospitalSchema = z.object(hospitalShape).superRefine(locationRule);
export const doctorSchema = z.object(doctorShape);
export const surveySchema = z
  .object({ ...hospitalShape, ...doctorShape })
  .superRefine(locationRule);

export type HospitalForm = z.input<typeof hospitalSchema>;
export type DoctorForm = z.input<typeof doctorSchema>;
export type SurveyForm = z.input<typeof surveySchema>;
export type SurveyOutput = z.output<typeof surveySchema>;

export function toBackendSlots(
  slots: z.infer<typeof slotSchema>[],
): { day_of_week: number; start_time: string; end_time: string }[] {
  return slots.flatMap((slot) =>
    slot.days.flatMap((day) =>
      slot.ranges.map((range) => ({
        day_of_week: DAY_NAME_TO_INT[day],
        start_time: range.start_time,
        end_time: range.end_time,
      })),
    ),
  );
}

export const emptySlot = () => ({
  days: ["Sat"] as DayName[],
  ranges: [{ ...EVENING_CHAMBER }],
});

export const emptyHospitalValues = (): HospitalForm => ({
  hospital_name: "",
  has_emergency_service: false,
  city: "",
  district: "",
  latitude: "",
  longitude: "",
  phones: [],
});

export const emptyDoctorValues = (): DoctorForm => ({
  phones: [{ value: "" }],
  doctor_name: "",
  doctor_degrees: "",
  doctor_specializations: "",
  daily_patients: "",
  avg_duration_min: "",
  consultation_fee_bdt: "",
  slots: [emptySlot()],
});

export const emptySurveyValues = (): SurveyForm => ({
  ...emptyHospitalValues(),
  ...emptyDoctorValues(),
});
