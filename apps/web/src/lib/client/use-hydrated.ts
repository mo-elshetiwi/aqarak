"use client";
import { useSyncExternalStore } from "react";
function subscribe(): () => void {
  return () => undefined;
}
/** Enables form input only after its handlers can preserve the entered value. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
