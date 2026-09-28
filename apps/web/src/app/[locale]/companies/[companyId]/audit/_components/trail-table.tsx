"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import type { AuditEvent } from "../_lib/schemas";
import { auditTime } from "./verification";
export function TrailTable({
  events,
  locale,
}: {
  events: AuditEvent[];
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Audit");
  return (
    <div
      role="region"
      aria-label={t("title")}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-ring"
    >
      <table className="w-full min-w-[64rem] text-start text-caption whitespace-nowrap">
        <caption className="sr-only">{t("title")}</caption>
        <thead className="bg-muted text-foreground">
          <tr>
            {[
              "time",
              "event",
              "actorRole",
              "initiatorChannel",
              "subjectReason",
            ].map((key) => (
              <th
                key={key}
                scope="col"
                className="h-11 px-3 text-start font-medium"
              >
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const role = event.actor?.role;
            const syntheticReason = event.details.syntheticReasonKey;
            return (
              <tr
                key={event.eventId}
                data-seq={event.seq}
                data-refused={event.refused}
                data-tone={event.refused ? "danger" : "neutral"}
                className={`h-11 border-t ${event.refused ? "border-status-danger-border bg-status-danger-bg text-status-danger-fg" : "bg-card"}`}
              >
                <td className="px-3 py-0 whitespace-nowrap">
                  <time dateTime={event.occurredAt}>
                    <bdi>{auditTime(event.occurredAt, locale)}</bdi>
                  </time>
                </td>
                <td className="px-3 py-0">
                  <bdi dir="ltr" className="font-mono">
                    {event.eventType}
                  </bdi>
                  {event.refused && (
                    <span className="ms-2 font-semibold">{t("refused")}</span>
                  )}
                </td>
                <td className="px-3 py-0">
                  <bdi>{event.actor?.displayName ?? t("system")}</bdi>
                  <span className="ms-2">
                    {role && t.has(`roles.${role}`)
                      ? t(`roles.${role}`)
                      : (role ?? t("system"))}
                  </span>
                </td>
                <td className="px-3 py-0">
                  <div className="flex gap-1">
                    <span className="rounded-full border px-2 py-1">
                      {t(`initiators.${event.initiator}`)}
                    </span>
                    <span className="rounded-full border px-2 py-1">
                      {t(`channels.${event.channel}`)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-0">
                  <bdi className="font-mono">
                    {typeof event.details.label === "string"
                      ? event.details.label
                      : event.subject.id}
                  </bdi>
                  {event.reason && (
                    <p>
                      <bdi>
                        {typeof syntheticReason === "string" &&
                        t.has(syntheticReason)
                          ? t(syntheticReason)
                          : event.reason}
                      </bdi>
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
