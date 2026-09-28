import { fireEvent, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { ThemeSwitch } from "./theme-switch";
import { ThemeScript } from "./theme-script";
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("light", "dark");
  localStorage.clear();
  vi.restoreAllMocks();
});
for (const locale of ["en", "ar"] as const) {
  it(`${locale} provides three named choices and saves explicit or system preferences`, () => {
    const messages = getMessages(locale).Theme;
    renderWithIntl(<ThemeSwitch />, { locale });
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    for (const choice of ["light", "dark", "system"] as const) {
      fireEvent.click(screen.getByRole("radio", { name: messages[choice] }));
      expect(localStorage.getItem("aqarak-theme")).toBe(choice);
      expect(
        screen.getByRole("radio", { name: messages[choice] }),
      ).toBeChecked();
      expect(document.documentElement.classList.contains("dark")).toBe(
        choice === "dark",
      );
      expect(document.documentElement.classList.contains("light")).toBe(
        choice === "light",
      );
    }
  });
}
it("allows the current tab to change theme when storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  renderWithIntl(<ThemeSwitch />);
  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  expect(document.documentElement).toHaveClass("dark");
});
it("renders one guarded pre-paint preference script", () => {
  const { container } = renderWithIntl(<ThemeScript />);
  const scripts = container.querySelectorAll("script");
  expect(scripts).toHaveLength(1);
  expect(scripts[0]?.textContent).toContain("aqarak-theme");
  expect(scripts[0]?.textContent).toContain("try{");
});
