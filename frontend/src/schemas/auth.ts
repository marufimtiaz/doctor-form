import { z } from "zod";

export const loginSchema = z.object({
  phone: z.string().trim().min(1, "Enter your phone number."),
  // Deliberately no length rule. Rejecting a short password here would tell
  // an attacker their guess was not even the right shape.
  password: z.string().min(1, "Enter your password."),
});

export type LoginForm = z.infer<typeof loginSchema>;
