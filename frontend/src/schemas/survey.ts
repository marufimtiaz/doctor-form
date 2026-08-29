import { z } from "zod";

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

export const slotSchema = z
  .object({
    days: z.array(z.enum(DAY_NAMES)).min(1, "Select at least one day."),
    start_time: z.string().min(1, "Start time is required."),
    end_time: z.string().min(1, "End time is required."),
  })
  .refine((slot) => slot.end_time > slot.start_time, {
    message: "End must be after start.",
    path: ["end_time"],
  });

export const surveySchema = z
  .object({
    hospital_name: z.string().trim().min(1, "Hospital name is required.").max(200),

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
    // useFieldArray needs objects, not bare strings.
    phones: z
      .array(z.object({ value: z.string().trim().min(1, "Enter a number.") }))
      .min(1, "Add at least one phone number."),
  })
  .superRefine((v, ctx) => {
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
  })
  .transform((data) => ({
    ...data,
    slots: data.slots.flatMap((s) =>
      s.days.map((day) => ({
        day_of_week: DAY_NAME_TO_INT[day],
        start_time: s.start_time,
        end_time: s.end_time,
      })),
    ),
  }));

export type SurveyForm = z.input<typeof surveySchema>;

export const emptySlot = () => ({
  days: ["Sat"] as DayName[],
  start_time: "17:00",
  end_time: "20:00",
});

export const emptySurveyValues = (): SurveyForm => ({
  hospital_name: "",
  city: "",
  district: "",
  latitude: "",
  longitude: "",
  daily_patients: "",
  avg_duration_min: "",
  consultation_fee_bdt: "",
  slots: [emptySlot()],
  phones: [{ value: "" }],
});
