import { describe, it, expect } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { resolveRequestLocale } from "./resolve-request";
describe("request locale resolution", () => {
  it("refuses an unsupported locale", () => {
    expect(resolveRequestLocale("fr")).toBeUndefined();
  });
  it.each([undefined, null, 42, ""])(
    "refuses invalid locale input %s",
    (value) => {
      expect(resolveRequestLocale(value)).toBeUndefined();
    },
  );
  it("loads the Arabic catalogue for Arabic requests", () => {
    expect(resolveRequestLocale("ar")).toEqual({
      locale: "ar",
      messages: getMessages("ar"),
    });
  });
});
