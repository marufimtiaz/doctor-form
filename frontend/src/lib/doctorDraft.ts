import type { DoctorForm } from "@/schemas/survey";

export const DOCTOR_DRAFT_KEY = "doctor-form:doctor-draft";

export interface StoredDoctorDraft {
  values: DoctorForm;
  nameplateBase64?: string | null;
  nameplateName?: string | null;
  nameplateType?: string | null;
}

export function serializeDoctorDraft(draft: StoredDoctorDraft): string {
  return JSON.stringify(draft);
}

export function parseStoredDoctorDraft(raw: string | null): StoredDoctorDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.values || typeof parsed.values !== "object") return null;
    return parsed as StoredDoctorDraft;
  } catch {
    return null;
  }
}

export function clearDoctorDraft(): void {
  try {
    sessionStorage.removeItem(DOCTOR_DRAFT_KEY);
  } catch {
    // Storage access unavailable
  }
}

export function readDoctorDraft(): StoredDoctorDraft | null {
  try {
    return parseStoredDoctorDraft(sessionStorage.getItem(DOCTOR_DRAFT_KEY));
  } catch {
    return null;
  }
}

export function writeDoctorDraft(draft: StoredDoctorDraft | null): void {
  try {
    if (draft) {
      sessionStorage.setItem(DOCTOR_DRAFT_KEY, serializeDoctorDraft(draft));
    } else {
      sessionStorage.removeItem(DOCTOR_DRAFT_KEY);
    }
  } catch {
    // Storage access unavailable or quota exceeded
  }
}

export async function fileToBase64(file: File): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${file.type || "application/octet-stream"};base64,${base64}`;
}

export function base64ToFile(
  dataUrl: string,
  fileName: string,
  fileType?: string,
): File {
  const arr = dataUrl.split(",");
  const mime = fileType || arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
  const bstr = atob(arr[1] || arr[0]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], fileName, { type: mime });
}
