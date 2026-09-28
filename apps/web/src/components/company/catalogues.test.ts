import { expect, it } from "vitest";
import { getMessages } from "@aqarak/i18n";
function paths(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, item]: [string, unknown]) => {
      const path = `${prefix}${key}`;
      return typeof item === "object" && item !== null
        ? paths(item, `${path}.`)
        : [path];
    })
    .sort();
}
it.each(["Members", "Company"] as const)(
  "keeps every %s catalogue key identical in English and Arabic",
  (namespace) => {
    expect(paths(getMessages("en")[namespace])).toEqual(
      paths(getMessages("ar")[namespace]),
    );
    for (const locale of ["en", "ar"] as const)
      for (const value of Object.values(getMessages(locale)[namespace]))
        expect(value.trim().length).toBeGreaterThan(0);
  },
);
