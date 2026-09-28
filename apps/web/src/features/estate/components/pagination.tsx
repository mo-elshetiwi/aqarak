"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { OwnerQuery } from "../contract";

import { pageLink } from "../pagination";
export function EstatePagination({
  base,
  query,
  nextCursor,
  previous,
  namespace,
}: {
  base: string;
  query: OwnerQuery;
  nextCursor: string | null;
  previous: string[];
  namespace: "Owners" | "Properties";
}): ReactElement {
  const t = useTranslations(namespace);
  return (
    <nav aria-label={t("pagination")} className="flex flex-wrap gap-5">
      {previous.length > 0 && (
        <a
          className="underline"
          href={pageLink(
            base,
            query,
            previous.at(-1) ?? null,
            previous.slice(0, -1),
          )}
        >
          {t("previous")}
        </a>
      )}
      {nextCursor && (
        <a
          className="underline"
          href={pageLink(base, query, nextCursor, [
            ...previous,
            query.cursor ?? "",
          ])}
        >
          {t("next")}
        </a>
      )}
    </nav>
  );
}
