import type { Row } from "./runtime/db";
import { string, nullableString } from "./runtime/sql";
import type { DraftInput } from "./schema";
import type { Parties } from "./repository";
export interface RenderedLanguage {
  title: string;
  sections: {
    number: number;
    heading: string;
    body: string;
    special: boolean;
  }[];
}
export interface RenderedContract {
  en: RenderedLanguage;
  ar: RenderedLanguage;
}
export function name(
  row: Row,
  prefix = "full_name",
): { en: string; ar: string } {
  return {
    en: nullableString(row, `${prefix}_en`) ?? "",
    ar: nullableString(row, `${prefix}_ar`) ?? "",
  };
}
function money(value: number, language: "en" | "ar"): string {
  const amount = (value / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  return language === "en" ? `AED ${amount}` : `${amount} درهم إماراتي`;
}
function date(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}
export function renderContract(input: {
  template: Row;
  company: Row;
  parties: Parties;
  draft: DraftInput;
  contractNo: string;
}): RenderedContract {
  function language(locale: "en" | "ar"): RenderedLanguage {
    const values: Record<string, string> = {
      contract_no: input.contractNo,
      company_name: name(input.company, "legal_name")[locale],
      owner_name: input.parties.owner ? name(input.parties.owner)[locale] : "",
      tenant_name: name(input.parties.tenant)[locale],
      unit_label: `${name(input.parties.property, "name")[locale]} / ${string(input.parties.unit, "unit_no")}`,
      term_start: date(input.draft.termStart),
      term_end: date(input.draft.termEnd),
      annual_rent: money(input.draft.annualRentFils, locale),
      deposit: money(input.draft.depositFils, locale),
      instalment_count: String(input.draft.instalments.length),
      grace_days: String(input.draft.graceDays),
    };
    const body = string(input.template, `body_${locale}`).replace(
      /\{\{([a-z_]+)\}\}/g,
      (_match: string, key: string) => values[key] ?? "",
    );
    const sections = body.split("\n\n").map((block, index) => {
      const [heading = "", ...lines] = block.split("\n");
      return {
        number: index + 1,
        heading: heading.replace(/^\d+\.\s*/, ""),
        body: lines.join("\n"),
        special: false,
      };
    });
    for (const clause of input.draft.specialClauses)
      sections.push({
        number: sections.length + 1,
        heading: locale === "en" ? "Special clause" : "شرط خاص",
        body: locale === "en" ? clause.textEn : clause.textAr,
        special: true,
      });
    return { title: string(input.template, `name_${locale}`), sections };
  }
  return { en: language("en"), ar: language("ar") };
}
