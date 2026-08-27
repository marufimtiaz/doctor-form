import { describe, expect, it } from "vitest";

import { changePasswordSchema, setPasswordSchema } from "./password";

describe("changePasswordSchema", () => {
  const valid = {
    current_password: "the-old-one",
    new_password: "a-long-enough-one",
    confirm_password: "a-long-enough-one",
  };

  it("accepts a matching pair", () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a mismatch, on the confirm field", () => {
    const result = changePasswordSchema.safeParse({
      ...valid,
      confirm_password: "something-else",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["confirm_password"]);
    }
  });

  it("rejects a password under 8 characters", () => {
    const short = { ...valid, new_password: "short", confirm_password: "short" };
    expect(changePasswordSchema.safeParse(short).success).toBe(false);
  });

  it("rejects a password over 128 characters", () => {
    const long = "x".repeat(129);
    const result = changePasswordSchema.safeParse({
      ...valid,
      new_password: long,
      confirm_password: long,
    });
    expect(result.success).toBe(false);
  });
});

describe("setPasswordSchema", () => {
  it("needs no current password", () => {
    const result = setPasswordSchema.safeParse({
      new_password: "a-long-enough-one",
      confirm_password: "a-long-enough-one",
    });
    expect(result.success).toBe(true);
  });
});
