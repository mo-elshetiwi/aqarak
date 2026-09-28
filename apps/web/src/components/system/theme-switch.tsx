"use client";
import { useSyncExternalStore, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

type ThemePreference = "system" | "light" | "dark";
function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener("aqarak-theme-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("aqarak-theme-change", listener);
  };
}
function snapshot(): ThemePreference {
  if (document.documentElement.classList.contains("dark")) return "dark";
  if (document.documentElement.classList.contains("light")) return "light";
  return "system";
}
function applyTheme(value: unknown): void {
  if (value !== "system" && value !== "light" && value !== "dark") return;
  document.documentElement.classList.remove("light", "dark");
  if (value !== "system") document.documentElement.classList.add(value);
  try {
    localStorage.setItem("aqarak-theme", value);
  } catch {
    /* The current tab can still change its appearance. */
  }
  window.dispatchEvent(new Event("aqarak-theme-change"));
}
/** Three visible choices follow the current tab's explicit preference. */
export function ThemeSwitch(): ReactElement {
  const translate = useTranslations("Theme");
  const theme = useSyncExternalStore(subscribe, snapshot, () => "system");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-label">{translate("label")}</legend>
      <RadioGroup
        aria-label={translate("label")}
        value={theme}
        onValueChange={applyTheme}
        className="flex flex-wrap gap-4"
      >
        {(["system", "light", "dark"] as const).map((option) => (
          <Label
            key={option}
            className="flex min-h-8 items-center gap-2 text-label"
          >
            <RadioGroupItem value={option} />
            {translate(option)}
          </Label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
