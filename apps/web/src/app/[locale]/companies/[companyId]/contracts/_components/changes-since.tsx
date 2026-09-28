"use client";
import type { ReactElement } from "react";
import type { Locale } from "@aqarak/i18n";
import { useTranslations } from "next-intl";
import { formatMoney, formatDate } from "@/lib/format";
import { termChanges, type Change } from "../_lib/term-changes";
import type { ContractDetail } from "../_lib/schemas";
export function ChangesSince({
  detail,
  predecessor,
  locale,
}: {
  detail: ContractDetail;
  predecessor: ContractDetail;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Contracts");
  const changes = termChanges(predecessor.version, detail.version);
  return (
    <section className="space-y-4" aria-labelledby="changes-heading">
      <h2 className="text-h2" id="changes-heading">
        {t("changes.title", { number: predecessor.contract.contractNo })}
      </h2>
      {!changes.length ? (
        <p>{t("changes.none")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table
            className="w-full text-body-dense"
            aria-labelledby="changes-heading"
          >
            <thead>
              <tr>
                {["term", "before", "after"].map((key) => (
                  <th key={key} scope="col" className="border-b p-3 text-start">
                    {t(`changes.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {changes.map((change, index) => (
                <tr key={index}>
                  <th
                    scope="row"
                    className="border-b p-3 text-start font-medium"
                  >
                    {change.kind === "clause" || change.kind === "instalment"
                      ? t(`changes.${change.kind}`, {
                          number: String(change.number),
                        })
                      : t(
                          change.field === "annualRentFils"
                            ? "rent"
                            : change.field,
                        )}
                  </th>
                  <td className="border-b p-3">
                    <ChangedValue
                      change={change}
                      side="before"
                      locale={locale}
                    />
                  </td>
                  <td className="border-b p-3">
                    <ChangedValue
                      change={change}
                      side="after"
                      locale={locale}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function ChangedValue({
  change,
  side,
  locale,
}: {
  change: Change;
  side: "before" | "after";
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Contracts");
  if (change.kind === "clause") {
    const value = change[side];
    return value ? (
      <div className="space-y-2">
        <p lang="en" dir="ltr" className="whitespace-pre-wrap">
          {value.textEn}
        </p>
        <p lang="ar" dir="rtl" className="whitespace-pre-wrap">
          {value.textAr}
        </p>
      </div>
    ) : (
      <span>{t("changes.absent")}</span>
    );
  }
  if (change.kind === "instalment") {
    const value = change[side];
    return value ? (
      <dl className="space-y-1">
        <div>
          <dt className="text-caption">{t("dueOn")}</dt>
          <dd>
            <bdi>{formatDate(value.dueOn, locale)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-caption">{t("amountFils")}</dt>
          <dd>
            <bdi>{formatMoney(value.amountFils, locale)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-caption">{t("changes.vatAmount")}</dt>
          <dd>
            <bdi>{formatMoney(value.vatFils, locale)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-caption">{t("chequeNo")}</dt>
          <dd>
            <bdi>{value.cheque?.chequeNo ?? t("changes.absent")}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-caption">{t("bankName")}</dt>
          <dd>
            <bdi>{value.cheque?.bankName ?? t("changes.absent")}</bdi>
          </dd>
        </div>
      </dl>
    ) : (
      <span>{t("changes.absent")}</span>
    );
  }
  const value = change[side];
  const formatted =
    change.kind === "money"
      ? formatMoney(Number(value), locale)
      : change.kind === "date"
        ? formatDate(String(value), locale)
        : change.kind === "vat"
          ? `${String(Number(value) / 100)}%`
          : String(value);
  return <bdi>{formatted}</bdi>;
}
