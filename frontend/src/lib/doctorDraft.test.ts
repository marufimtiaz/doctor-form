import { beforeEach, describe, expect, it } from "vitest";

import {
  base64ToFile,
  clearDoctorDraft,
  fileToBase64,
  parseStoredDoctorDraft,
  readDoctorDraft,
  serializeDoctorDraft,
  writeDoctorDraft,
  type StoredDoctorDraft,
} from "@/lib/doctorDraft";

const draft: StoredDoctorDraft = {
  values: {
    doctor_name: "Dr. Smith",
    doctor_degrees: "MBBS",
    doctor_specializations: "Cardiology",
    phones: [{ value: "01712345678" }],
    slots: [],
    daily_patients: 20,
    avg_duration_min: 15,
    consultation_fee_bdt: 1000,
  },
  nameplateBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  nameplateName: "test.png",
  nameplateType: "image/png",
};

describe("doctorDraft helper", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a draft through serialize and parse", () => {
    const raw = serializeDoctorDraft(draft);
    expect(parseStoredDoctorDraft(raw)).toEqual(draft);
  });

  it("returns null for invalid or empty inputs", () => {
    expect(parseStoredDoctorDraft(null)).toBeNull();
    expect(parseStoredDoctorDraft("not-json")).toBeNull();
    expect(parseStoredDoctorDraft("{}")).toBeNull();
  });

  it("writes and reads draft from sessionStorage", () => {
    writeDoctorDraft(draft);
    expect(readDoctorDraft()).toEqual(draft);

    clearDoctorDraft();
    expect(readDoctorDraft()).toBeNull();
  });

  it("converts Base64 to File correctly", () => {
    if (!draft.nameplateBase64 || !draft.nameplateName) return;
    const file = base64ToFile(draft.nameplateBase64, draft.nameplateName, draft.nameplateType ?? undefined);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("test.png");
    expect(file.type).toBe("image/png");
  });

  it("converts File to Base64 data URL", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const file = new File([blob], "hello.txt", { type: "text/plain" });
    const base64 = await fileToBase64(file);
    expect(base64).toContain("data:text/plain;base64,");
  });
});
