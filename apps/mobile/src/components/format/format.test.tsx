import { render, screen } from "@testing-library/react-native";
import { Text } from "@/components/ui/text";
import { LocaleProvider } from "@/features/locale/locale-provider";
import {
  formatMoney,
  formatDate,
  formatTime,
  formatAge,
  maskIdentifier,
  westernIdentifier,
} from "./format";
import { DateText, Identifier, Money, TimeText } from "./formatted-text";
it("AC-8 formats safe integer fils exactly, including fractions, signs and the safe-integer boundary", () => {
  expect(formatMoney(8500000, "en")).toBe("AED 85,000.00");
  expect(formatMoney(8500000, "ar")).toBe("85,000.00 درهم");
  expect(formatMoney(1, "en")).toBe("AED 0.01");
  expect(formatMoney(-125050, "en")).toBe("-AED 1,250.50");
  expect(formatMoney(-125050, "ar")).toBe("-1,250.50 درهم");
  expect(formatMoney(Number.MAX_SAFE_INTEGER, "en")).toBe(
    "AED 90,071,992,547,409.91",
  );
  for (const invalid of [1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => formatMoney(invalid, "en")).toThrow(RangeError);
});
it("AC-8 formats Gregorian Dubai dates, 24-hour times and an injected age with Western digits", () => {
  expect(formatDate("2026-09-28")).toBe("28/09/2026");
  expect(formatTime("2026-09-28T06:42:00Z")).toBe("10:42");
  expect(formatDate("2026-09-28T21:00:00Z")).toBe("29/09/2026");
  expect(formatAge("2026-09-28", "2026-10-01", "en")).toBe("3 days");
  expect(formatAge("2026-09-28", "2026-10-01", "ar")).toBe("منذ 3 أيام");
  expect(() => formatDate("invalid")).toThrow(RangeError);
});
it("AC-8 masks only interior digits and keeps every separator", () => {
  expect(maskIdentifier("784-1978-4829163-5")).toBe("784-••••-•••••63-5");
  expect(westernIdentifier("٧٨٤-۱۹۷۸")).toBe("784-1978");
  expect(maskIdentifier("12-34")).toBe("12-34");
});
it("AC-8 isolates mono identifiers within Arabic and renders thin money and date components", async () => {
  await render(
    <LocaleProvider initialLocale="ar">
      <Text>
        مرجع <Identifier value="784-1978-4829163-5" masked />
      </Text>
      <Money fils={8500000} />
      <DateText value="2026-09-28" now="2026-10-01" />
      <TimeText value="2026-09-28T06:42:00Z" />
    </LocaleProvider>,
  );
  expect(screen.getByText("\u2066784-••••-•••••63-5\u2069")).toHaveStyle({
    writingDirection: "ltr",
    fontFamily: "IBMPlexMono_400Regular",
  });
  expect(screen.getByText("85,000.00 درهم")).toHaveStyle({
    fontVariant: ["tabular-nums"],
  });
  expect(screen.getByText("28/09/2026 · منذ 3 أيام")).toBeTruthy();
  expect(screen.getByText("10:42")).toBeTruthy();
});
