import { z } from "zod";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const password = z
  .string()
  .min(PASSWORD_MIN, `Must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Must be at most ${PASSWORD_MAX} characters.`);

const matching = <T extends { new_password: string; confirm_password: string }>(
  values: T,
  ctx: z.RefinementCtx,
) => {
  if (values.new_password !== values.confirm_password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirm_password"],
      message: "The two passwords do not match.",
    });
  }
};

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: password,
    confirm_password: z.string(),
  })
  .superRefine(matching);

/** An admin setting somebody else's password: no current password needed. */
export const setPasswordSchema = z
  .object({
    new_password: password,
    confirm_password: z.string(),
  })
  .superRefine(matching);

export type ChangePasswordForm = z.infer<typeof changePasswordSchema>;
export type SetPasswordForm = z.infer<typeof setPasswordSchema>;
