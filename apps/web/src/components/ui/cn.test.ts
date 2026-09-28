import { expect, it } from "vitest";
import { typeScale } from "@aqarak/ui-tokens";
import { cn } from "@/lib/utils";
it.each(Object.keys(typeScale.latin))(
  "retains the %s size alongside a semantic colour",
  (size) => {
    expect(cn(`text-${size}`, "text-foreground")).toBe(
      `text-${size} text-foreground`,
    );
    expect(cn("text-foreground", `text-${size}`)).toBe(
      `text-foreground text-${size}`,
    );
  },
);
it("still resolves explicit size and geometry overrides", () => {
  expect(cn("text-body", "text-label", "text-brand")).toBe(
    "text-label text-brand",
  );
  expect(cn("h-9", "h-10")).toBe("h-10");
});

it("retains named type sizes and muted colours through the shared alias", () => {
  expect(cn("text-label text-muted-foreground")).toBe(
    "text-label text-muted-foreground",
  );
});
