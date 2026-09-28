"use client";
import { useLayoutEffect } from "react";
import type { Locale } from "@aqarak/i18n";
/** Restores the stored appearance when locale navigation replaces root attributes. */
export function ThemePreference({ locale }: { locale: Locale }): null {
  useLayoutEffect(() => {
    try {
      const preference = localStorage.getItem("aqarak-theme");
      document.documentElement.classList.remove("light", "dark");
      if (preference === "light" || preference === "dark")
        document.documentElement.classList.add(preference);
      window.dispatchEvent(new Event("aqarak-theme-change"));
    } catch {
      /* I retain the current appearance when storage is unavailable. */
    }
  }, [locale]);
  return null;
}
