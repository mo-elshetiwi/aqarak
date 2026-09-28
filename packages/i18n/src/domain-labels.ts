import type * as domain from "@aqarak/domain";
import en from "../messages/domain/en.json";
import ar from "../messages/domain/ar.json";
import type { Locale } from "./index";

type DomainExports = typeof domain;
/** Names every public closed domain vocabulary, including refusal lists. */
export type DomainVocabularyName = {
  [Name in keyof DomainExports]: DomainExports[Name] extends {
    readonly options: readonly string[];
    readonly enum: object;
  }
    ? Name
    : never;
}[keyof DomainExports];
/** Restricts a label lookup to values stored by the selected vocabulary. */
export type DomainVocabularyValue<Name extends DomainVocabularyName> =
  DomainExports[Name] extends {
    readonly options: readonly (infer Value extends string)[];
  }
    ? Value
    : never;
type ErrorVocabularyName = Extract<DomainVocabularyName, `${string}ErrorCode`>;
/** Requires a label for every exported enum value and every distinct refusal code. */
export type DomainLabels = {
  [Name in DomainVocabularyName]: Record<DomainVocabularyValue<Name>, string>;
} & {
  errors: Record<DomainVocabularyValue<ErrorVocabularyName>, string>;
};

const catalogues = { en, ar } satisfies Record<Locale, DomainLabels>;

/** Returns the complete domain catalogue for the selected locale. */
export function getDomainLabels(locale: Locale): DomainLabels {
  return catalogues[locale];
}

/** Looks up a stored value without allowing values from another vocabulary. */
export function domainLabel<Name extends DomainVocabularyName>(
  locale: Locale,
  vocabularyName: Name,
  value: NoInfer<DomainVocabularyValue<Name>>,
): string {
  const labels = getDomainLabels(locale)[vocabularyName] as Record<
    DomainVocabularyValue<Name>,
    string
  >;
  return labels[value];
}
