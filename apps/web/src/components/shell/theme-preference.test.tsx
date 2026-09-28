import { cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render-with-intl";
import { ThemePreference } from "./theme-preference";
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("light", "dark");
  vi.restoreAllMocks();
});
it("restores the explicit appearance when navigation replaces root classes", () => {
  localStorage.setItem("aqarak-theme", "dark");
  const { rerender } = renderWithIntl(<ThemePreference locale="en" />);
  expect(document.documentElement).toHaveClass("dark");
  document.documentElement.classList.remove("dark");
  rerender(<ThemePreference locale="ar" />);
  expect(document.documentElement).toHaveClass("dark");
});
it("preserves the current appearance if storage cannot be read", () => {
  document.documentElement.classList.add("dark");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Unavailable storage");
  });
  renderWithIntl(<ThemePreference locale="en" />);
  expect(document.documentElement).toHaveClass("dark");
});
