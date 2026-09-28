import { describe, expect, expectTypeOf, it } from "vitest";
import * as domain from "@aqarak/domain";
import en from "../messages/domain/en.json";
import ar from "../messages/domain/ar.json";
import {
  domainLabel,
  getDomainLabels,
  type DomainVocabularyName,
  type DomainVocabularyValue,
} from "./index";

function isZodEnum(value: unknown): value is {
  readonly options: readonly string[];
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "def" in value &&
    typeof value.def === "object" &&
    value.def !== null &&
    "type" in value.def &&
    value.def.type === "enum" &&
    "options" in value &&
    Array.isArray(value.options)
  );
}

const exports: [string, unknown][] = Object.entries(domain);
const enumerations = exports.filter(
  (entry): entry is [string, { readonly options: readonly string[] }] =>
    isZodEnum(entry[1]),
);
const catalogues: Record<string, Record<string, Record<string, string>>> = {
  en,
  ar,
};

function keyPaths(catalogue: Record<string, Record<string, string>>): string[] {
  return Object.entries(catalogue)
    .flatMap(([name, labels]) =>
      Object.keys(labels).map((value) => `${name}.${value}`),
    )
    .sort();
}

describe("domain label completeness", () => {
  it("discovers the public Zod enums", () => {
    expect(enumerations.length).toBeGreaterThan(0);
    expect(enumerations.map(([name]) => name)).toContain("role");
    expect(enumerations.map(([name]) => name)).toContain("documentsErrorCode");
  });

  for (const [locale, catalogue] of Object.entries(catalogues)) {
    it.each(enumerations)(
      `${locale}: labels every value of %s`,
      (name, schema) => {
        expect(Object.keys(catalogue[name] ?? {}).sort()).toEqual(
          [...schema.options].sort(),
        );
        for (const value of schema.options) {
          expect(
            catalogue[name]?.[value],
            `${locale}.${name}.${value}`,
          ).toBeTypeOf("string");
          expect(catalogue[name]?.[value]?.trim().length).toBeGreaterThan(0);
          if (name.endsWith("ErrorCode")) {
            expect(
              catalogue.errors?.[value],
              `${locale}.errors.${value}`,
            ).toBeTypeOf("string");
            expect(catalogue.errors?.[value]?.trim().length).toBeGreaterThan(0);
          }
        }
      },
    );
  }

  it("keeps identical key paths and no unexported vocabulary", () => {
    expect(keyPaths(ar)).toEqual(keyPaths(en));
    expect(Object.keys(en).sort()).toEqual(
      [...enumerations.map(([name]) => name), "errors"].sort(),
    );
    const codes = new Set(
      enumerations
        .filter(([name]) => name.endsWith("ErrorCode"))
        .flatMap(([, schema]) => schema.options),
    );
    expect(Object.keys(en.errors).sort()).toEqual([...codes].sort());
  });

  it("uses Arabic without Latin letters except approved abbreviations", () => {
    for (const [name, labels] of Object.entries(ar)) {
      for (const [value, label] of Object.entries(labels)) {
        const permitted =
          name === "numberSeries"
            ? /\b(?:INV|CN|RCPT|STMT)\b/g
            : /\b(?:TRN|VAT|UNT|PDF)\b/g;
        expect(label.replace(permitted, ""), `${name}.${value}`).not.toMatch(
          /[A-Za-z]/,
        );
      }
    }
  });

  it("looks up both languages and retains the supplied glossary", () => {
    expect(getDomainLabels("en")).toEqual(en);
    expect(getDomainLabels("ar")).toEqual(ar);
    expect(domainLabel("en", "unitStatus", "occupied")).toBe("Occupied");
    expect(domainLabel("ar", "unitStatus", "occupied")).toBe("مؤجرة");
    expect(domainLabel("ar", "chargeStatus", "invoiced")).toBe("مفوترة");
    expect(domainLabel("ar", "coreErrorCode", "REASON_REQUIRED")).toBe(
      "أدخل السبب للمتابعة.",
    );
  });

  it("couples vocabulary names to their stored values at compile time", () => {
    expectTypeOf<DomainVocabularyName>().extract<"unknown">().toBeNever();
    expectTypeOf<DomainVocabularyValue<"unitStatus">>()
      .extract<"settled">()
      .toBeNever();
    expectTypeOf<
      Parameters<typeof domainLabel<"unitStatus">>[2]
    >().toEqualTypeOf<domain.UnitStatus>();
    expectTypeOf<
      Parameters<typeof domainLabel<"chargeStatus">>[2]
    >().toEqualTypeOf<domain.ChargeStatus>();
  });
});
