"use client";
import Link from "next/link";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { Button } from "@/components/ui/button";
import type {
  Comparison,
  ResolutionsInput,
  TawtheeqRecord,
} from "../_lib/schemas";
import {
  comparisonClass,
  consequence,
  equivalentAllowed,
  sortedComparison,
} from "../_lib/presentation";
import { ActionError, controlClass, Value } from "./common";
import { useMutation, type RunAction } from "./use-mutation";
type Choice = ResolutionsInput["choices"][number];
export function ComparisonPanel({
  record,
  locale,
  run,
}: {
  record: TawtheeqRecord;
  locale: Locale;
  run: RunAction;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const [choices, setChoices] = useState<Record<string, Partial<Choice>>>({});
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { busy, error, submit } = useMutation(run);
  const open = record.discrepancies.filter((d) => d.status === "open");
  const valid =
    open.length > 0 &&
    open.every(
      (d) =>
        choices[d.id]?.kind &&
        choices[d.id]?.reason?.trim() &&
        (choices[d.id]?.kind !== "mark_equivalent" || choices[d.id]?.basis),
    );
  function change(id: string, patch: Partial<Choice>): void {
    setChoices((prior) => ({
      ...prior,
      [id]: { ...prior[id], ...patch, discrepancyId: id },
    }));
    setKey(crypto.randomUUID());
  }
  return (
    <section className="min-w-0 space-y-4" aria-labelledby="comparison-title">
      <h2 id="comparison-title" className="text-h2">
        {t("comparisonTitle")}
      </h2>
      <p>{t("comparisonHelp")}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid)
            void submit(
              {
                command: "submitResolutions",
                input: {
                  expectedVersion: record.version,
                  choices: open.map((d) => choices[d.id] as Choice),
                },
              },
              key,
            );
        }}
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-start">
            <caption className="sr-only">{t("comparisonTitle")}</caption>
            <thead className="bg-muted">
              <tr>
                {["field", "contract", "registered", "class", "resolution"].map(
                  (label) => (
                    <th
                      key={label}
                      scope="col"
                      className="p-3 text-start font-medium"
                    >
                      {t(label)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {sortedComparison(record.comparison).map((row) => {
                const d = open.find((item) => item.field === row.field);
                const label = t(`fields.${row.field}`);
                return (
                  <tr
                    key={row.field}
                    data-field={row.field}
                    className="border-t align-top"
                  >
                    <th scope="row" className="p-3 text-start font-medium">
                      {label}
                      {record.discrepancies.find(
                        (item) => item.field === row.field,
                      ) && (
                        <Link
                          className="mt-1 block min-h-6 text-brand underline"
                          href={`?tab=history&subjectType=discrepancy&subjectId=${record.discrepancies.find((item) => item.field === row.field)?.id ?? ""}`}
                        >
                          {t("discrepancyHistory")}
                        </Link>
                      )}
                      {row.status.startsWith("missing") && (
                        <p className="mt-2 font-normal text-status-attention-fg">
                          {t("uncertain")}
                        </p>
                      )}
                    </th>
                    <td className="p-3">
                      <Value
                        field={row.field}
                        value={row.contractValue}
                        locale={locale}
                      />
                    </td>
                    <td className="p-3">
                      <Value
                        field={row.field}
                        value={row.registeredValue}
                        locale={locale}
                      />
                    </td>
                    <td className="p-3">
                      <span
                        className={
                          row.class === "material" && row.status !== "match"
                            ? "font-semibold text-status-danger-fg"
                            : "text-foreground"
                        }
                      >
                        {t(`classes.${comparisonClass(row)}`)}
                      </span>
                    </td>
                    <td className="min-w-64 space-y-3 p-3">
                      {d ? (
                        <ResolutionControls
                          row={row}
                          discrepancyId={d.id}
                          choice={choices[d.id]}
                          busy={busy}
                          gate={record.contract.frozenOwnerGate}
                          change={change}
                        />
                      ) : (
                        <span>
                          {t(
                            row.status === "match"
                              ? "classes.match"
                              : "noResolution",
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ActionError error={error} />
        <div className="flex justify-end">
          <Button type="submit" disabled={!valid || busy}>
            {t("resolve", { count: open.length })}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ResolutionControls({
  row,
  discrepancyId: id,
  choice,
  busy,
  gate,
  change,
}: {
  row: Comparison;
  discrepancyId: string;
  choice: Partial<Choice> | undefined;
  busy: boolean;
  gate: boolean;
  change: (id: string, patch: Partial<Choice>) => void;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const label = t(`fields.${row.field}`);
  const allowed = equivalentAllowed(row);
  return (
    <>
      <label className="sr-only" htmlFor={`choice-${id}`}>
        {t("resolution")} · {label}
      </label>
      <select
        id={`choice-${id}`}
        className={controlClass}
        value={choice?.kind ?? ""}
        disabled={busy}
        aria-describedby={!allowed ? `equivalent-${id}` : undefined}
        onChange={(e) => {
          change(id, {
            kind: e.target.value as Choice["kind"],
            basis: "formatting",
          });
        }}
      >
        <option value="">{t("choose")}</option>
        <option value="adopt">{t("adopt")}</option>
        <option value="cancel_and_reregister">
          {t("cancel_and_reregister")}
        </option>
        <option value="mark_equivalent" disabled={!allowed}>
          {t("mark_equivalent")}
        </option>
      </select>
      {!allowed && (
        <p
          id={`equivalent-${id}`}
          className="text-base leading-relaxed text-muted-foreground"
        >
          {t("equivalentDisabled")}
        </p>
      )}
      {choice?.kind === "mark_equivalent" && (
        <>
          <label htmlFor={`basis-${id}`}>
            {t("basis")} · {label}
          </label>
          <select
            id={`basis-${id}`}
            className={controlClass}
            value={choice.basis ?? "formatting"}
            disabled={busy}
            onChange={(e) => {
              change(id, { basis: e.target.value as Choice["basis"] });
            }}
          >
            <option value="formatting">{t("formatting")}</option>
            <option value="transliteration">{t("transliteration")}</option>
          </select>
        </>
      )}
      <label className="block" htmlFor={`reason-${id}`}>
        {t("reason")} · {label}
      </label>
      <textarea
        id={`reason-${id}`}
        required
        maxLength={2000}
        className={controlClass}
        value={choice?.reason ?? ""}
        disabled={busy}
        onChange={(e) => {
          change(id, { reason: e.target.value });
        }}
      />
      {choice?.kind && (
        <p
          className="rounded-md bg-muted p-3"
          data-testid={`consequence-${row.field}`}
        >
          {t(consequence(choice.kind, row.class === "material", gate))}
        </p>
      )}
    </>
  );
}
