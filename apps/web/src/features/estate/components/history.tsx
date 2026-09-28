"use client";
import type { ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DateText } from "@/components/system/formatted-values";
import type { PropertyDetail } from "../contract";

export function EstateHistory({
  entries,
  namespace,
}: {
  entries: PropertyDetail["history"];
  namespace: "Owners" | "Properties";
}): ReactElement {
  const t = useTranslations(namespace);
  const locale = useLocale() === "ar" ? "ar" : "en";
  return (
    <section className="space-y-4">
      <h2 className="text-h2">{t("history")}</h2>
      {entries.length ? (
        <ol className="space-y-4 border-s ps-4">
          {entries.map((entry, index) => (
            <li key={index}>
              <p className="text-body-strong">{t("historyEvent")}</p>
              <p>
                {entry.actorDisplayName ?? t("unknownPerson")}{" "}
                <DateText iso={entry.occurredAt} locale={locale} />
              </p>
              {entry.reason && <p>{entry.reason}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p>{t("noHistory")}</p>
      )}
    </section>
  );
}
