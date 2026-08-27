import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names and resolves Tailwind conflicts, so a caller's
 *  `className` can override a component's own utilities. Every shadcn
 *  primitive imports this. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
