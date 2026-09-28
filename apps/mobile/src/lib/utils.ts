import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
/** Merges conditional utility classes while resolving conflicting values. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
