"use client";
import type { ReactElement } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { PageHeader } from "@/components/system/page-header";
import type { Versions } from "../../audit/_lib/schemas";
import { auditTime } from "../../audit/_components/verification";
import { fieldKeySchema } from "../_lib/schemas";
import { Connectivity, Value } from "./common";
export function HistoryScreen({
  history,
  locale,
  recordHref,
}: {
  history: Versions;
  locale: Locale;
  recordHref: string;
}): ReactElement {
  const t = useTranslations("Audit");
  const tw = useTranslations("Tawtheeq");
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("historyTitle")}
        description={t("historyDescription")}
      />
      <nav className="flex gap-6 border-b pb-3">
        <Link className="text-brand underline" href={recordHref}>
          {tw("overview")}
        </Link>
        <span aria-current="page">{tw("history")}</span>
      </nav>
      <Connectivity />
      <p>
        {t("subject")}:{" "}
        <bdi className="font-mono">
          {history.subject.type} / {history.subject.id}
        </bdi>
      </p>
      {!history.versions.length && <p role="status">{t("historyEmpty")}</p>}
      {[...history.versions]
        .sort((a, b) => a.version - b.version)
        .map((version) => (
          <section
            key={version.version}
            className="space-y-4 rounded-lg border bg-card p-4"
            data-testid="history-version"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-h2">
                {t("version", { version: version.version })}
              </h2>
              <time dateTime={version.recordedAt}>
                <bdi>{auditTime(version.recordedAt, locale)}</bdi>
              </time>
            </div>
            <p>
              {t("coveringEvent")}:{" "}
              {version.event ? (
                <>
                  <bdi className="font-mono">
                    {version.event.seq} ·{" "}
                    {version.event.eventType ?? t("unknown")}
                  </bdi>{" "}
                  · <bdi>{version.event.actorDisplayName ?? t("system")}</bdi> ·{" "}
                  {version.event.actorRole &&
                  t.has(`roles.${version.event.actorRole}`)
                    ? t(`roles.${version.event.actorRole}`)
                    : version.event.actorRole}
                </>
              ) : (
                t("noEvent")
              )}
            </p>
            {version.event?.reason && (
              <p>
                <bdi>{version.event.reason}</bdi>
              </p>
            )}
            <details>
              <summary className="min-h-6 cursor-pointer">
                {t("snapshotHash")}
              </summary>
              <bdi className="break-all font-mono">
                {version.snapshotSha256}
              </bdi>
            </details>
            {version.diff.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-start">
                  <caption className="sr-only">
                    {t("version", { version: version.version })}
                  </caption>
                  <thead>
                    <tr>
                      {["field", "before", "after"].map((key) => (
                        <th key={key} className="p-2 text-start" scope="col">
                          {t(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {version.diff.map((diff) => {
                      const field = fieldKeySchema.safeParse(diff.field);
                      return (
                        <tr
                          key={diff.field}
                          className="border-t"
                          data-field={diff.field}
                        >
                          <th
                            scope="row"
                            className="p-2 text-start font-medium"
                          >
                            {field.success ? (
                              tw(`fields.${field.data}`)
                            ) : tw.has(diff.field) ? (
                              tw(diff.field)
                            ) : (
                              <bdi>{diff.field}</bdi>
                            )}
                          </th>
                          <td className="p-2">
                            <HistoryValue
                              field={diff.field}
                              value={diff.before}
                              locale={locale}
                            />
                          </td>
                          <td className="p-2">
                            <HistoryValue
                              field={diff.field}
                              value={diff.after}
                              locale={locale}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>{t("noDiff")}</p>
            )}
          </section>
        ))}
    </div>
  );
}
function HistoryValue({
  field,
  value,
  locale,
}: {
  field: string;
  value: unknown;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const parsed = fieldKeySchema.safeParse(field);
  if (
    parsed.success &&
    (typeof value === "string" || typeof value === "number" || value === null)
  )
    return <Value field={parsed.data} value={value} locale={locale} />;
  if (
    (field === "workflow_state" || field === "workflowState") &&
    typeof value === "string" &&
    t.has(`states.${value}`)
  )
    return <span>{t(`states.${value}`)}</span>;
  return (
    <bdi dir="auto" className="break-all">
      {value === null
        ? t("unknown")
        : typeof value === "string"
          ? value
          : JSON.stringify(value)}
    </bdi>
  );
}
