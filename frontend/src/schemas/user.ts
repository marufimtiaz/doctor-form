import { z } from "zod";

import { PASSWORD_MAX, PASSWORD_MIN } from "./password";

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  phone: z.string().trim().min(1, "Phone is required.").max(32),
  company: z.string().trim().min(1, "Company is required.").max(200),
  role: z.enum(["agent", "admin"]).default("agent"),
  password: z
    .string()
    .min(PASSWORD_MIN, `Must be at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, `Must be at most ${PASSWORD_MAX} characters.`);
});

export type CreateUserForm = z.infer<typeof createUserSchema>;
