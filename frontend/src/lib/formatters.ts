import type { Slot, Survey } from "@/api";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function describeSlot(slot: Slot): string {
  return `${DAY_LABELS[slot.day_of_week]} ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;
}

export function describePlace(s: Survey): string {
  const parts: string[] = [];
  if (s.city && s.district) parts.push(`${s.city}, ${s.district}`);
  if (s.latitude !== null && s.longitude !== null) {
    parts.push(`(${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`);
  }
  return parts.join(" ");
}
