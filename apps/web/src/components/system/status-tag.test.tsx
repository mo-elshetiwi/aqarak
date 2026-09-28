import { describe, expect, it } from "vitest";
import { statusTones } from "@aqarak/ui-tokens";
import { renderWithIntl } from "@/test/render-with-intl";
import { expectedStatuses } from "@/test/status-contract";
import { StatusTag, statusEntries } from "./status-tag";
for (const locale of ["en", "ar"] as const) {
  describe(`${locale} status catalogue`, () => {
    it.each(expectedStatuses)(
      "$entity / $state has its contracted word, tone and icon",
      (entry) => {
        const { container } = renderWithIntl(<StatusTag {...entry} />, {
          locale,
        });
        const tag = container.firstElementChild;
        expect(tag?.textContent).toBe(
          locale === "en" ? entry.english : entry.arabic,
        );
        expect(tag).toHaveClass(
          `bg-status-${entry.tone}-bg`,
          `text-status-${entry.tone}-fg`,
          `border-status-${entry.tone}-border`,
        );
        const icon = tag?.querySelector('svg[aria-hidden="true"]');
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveClass("size-3");
        expect(tag).toHaveClass("h-5");
        expect(icon).toHaveClass(`lucide-${statusTones[entry.tone].icon}`);
      },
    );
  });
}
it("covers exactly the thirteen entities and all 73 contracted states", () => {
  const keys = (
    entries: readonly { entity: string; state: string }[],
  ): string[] =>
    entries.map((entry) => `${entry.entity}/${entry.state}`).sort();
  expect(keys(statusEntries)).toEqual(keys(expectedStatuses));
  expect(new Set(statusEntries.map((entry) => entry.entity)).size).toBe(13);
  expect(statusEntries).toHaveLength(73);
});
