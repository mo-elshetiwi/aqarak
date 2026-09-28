"use client";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Locale } from "@aqarak/i18n";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState } from "@/components/system/screen-states";
import { workflowStateSchema, type RecordList } from "../_lib/schemas";
import { Connectivity, controlClass, WorkflowStatus } from "./common";
export function Board({
  records,
  locale,
  companyId,
  synthetic,
}: {
  records: RecordList["records"];
  locale: Locale;
  companyId: string;
  synthetic: boolean;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const [filter, setFilter] = useState("");
  const visible = records.filter((r) => !filter || r.workflowState === filter);
  return (
    <div className="space-y-6 text-base leading-relaxed">
      <PageHeader title={t("title")} description={t("boardDescription")} />
      <Connectivity />
      {synthetic && (
        <p className="rounded-md border bg-muted p-4">{t("syntheticNote")}</p>
      )}
      <div className="max-w-sm space-y-2">
        <label htmlFor="workflow-filter">{t("filter")}</label>
        <select
          id="workflow-filter"
          className={controlClass}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        >
          <option value="">{t("allStates")}</option>
          {workflowStateSchema.options.map((state) => (
            <option key={state} value={state}>
              {t(`states.${state}`)}
            </option>
          ))}
        </select>
      </div>
      {!records.length ? (
        <EmptyState variant="no-records" message={t("noRecords")} />
      ) : !visible.length ? (
        <EmptyState
          variant="no-matches"
          message={t("noMatches")}
          actionLabel={t("clearFilters")}
          onAction={() => {
            setFilter("");
          }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-start">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="bg-muted">
              <tr>
                {[
                  "contract",
                  "unit",
                  "tenant",
                  "state",
                  "pending",
                  "openDifferences",
                ].map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="p-4 text-start font-medium"
                  >
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-4">
                    <Link
                      className="inline-flex min-h-6 items-center font-semibold text-brand underline"
                      href={`/${locale}/companies/${companyId}/tawtheeq/${r.id}`}
                    >
                      <bdi>{r.contractNo}</bdi>
                    </Link>
                  </td>
                  <td className="p-4">
                    <bdi>{r.unitLabel}</bdi>
                  </td>
                  <td className="p-4">
                    <bdi dir="auto">{r.tenantName ?? t("unknown")}</bdi>
                  </td>
                  <td className="p-4">
                    <WorkflowStatus state={r.workflowState} />
                  </td>
                  <td className="p-4 tabular-nums">
                    {r.daysPending === null
                      ? t("none")
                      : t("days", { count: r.daysPending })}
                  </td>
                  <td className="p-4 tabular-nums">{r.openDiscrepancies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
