"use client";
import type { ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/system/screen-states";
import { StatusTag } from "@/components/system/status-tag";
import {
  unitStatusSchema,
  type PropertyListItem,
  type PropertyQuery,
} from "../contract";
import { EstatePagination } from "./pagination";
import { EstateHeader, cellClass, controlClass, estateBase } from "./shared";
export function PropertiesList({
  items,
  companyId,
  query,
  nextCursor,
  previous = [],
}: {
  items: PropertyListItem[];
  companyId: string;
  query: PropertyQuery;
  nextCursor: string | null;
  previous?: string[];
}): ReactElement {
  const t = useTranslations("Properties");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  const router = useRouter();
  const base = `${estateBase(locale, companyId)}/properties`;
  return (
    <div className="space-y-6">
      <EstateHeader
        title={t("title")}
        {...(items.length ? { href: `${base}/new`, action: t("add") } : {})}
      />
      <form method="get" action={base} className="flex items-end gap-3">
        <label className="flex-1 space-y-2">
          {t("search")}
          <input className={controlClass} name="q" defaultValue={query.q} />
        </label>
        <Button variant="secondary" type="submit">
          {t("searchSubmit")}
        </Button>
      </form>
      {items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  "property",
                  "owner",
                  "units",
                  "status",
                  "titleDeed",
                  "approval",
                ].map((key) => (
                  <th key={key} scope="col" className={cellClass}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((property) => (
                <tr key={property.id}>
                  <td className={cellClass}>
                    <a
                      href={`${base}/${property.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      <span className="block text-body-strong" lang="en">
                        {property.name.en}
                      </span>
                      <span className="block text-caption" lang="ar" dir="rtl">
                        {property.name.ar}
                        {property.area && (
                          <span className="ms-2 text-muted-foreground">
                            {property.area[locale]}
                          </span>
                        )}
                      </span>
                    </a>
                  </td>
                  <td className={cellClass}>
                    {property.owners
                      .map((o) => o.fullName[locale])
                      .join(locale === "ar" ? "، " : ", ")}
                  </td>
                  <td className={cellClass}>
                    <bdi dir="ltr">{property.unitCount}</bdi>
                  </td>
                  <td className={cellClass}>
                    <div className="flex gap-2">
                      {unitStatusSchema.options
                        .filter((status) => property.unitsByStatus[status] > 0)
                        .map((status) => (
                          <span
                            key={status}
                            className="inline-flex items-center gap-1"
                          >
                            <StatusTag entity="unit" state={status} />
                            <bdi dir="ltr">
                              {property.unitsByStatus[status]}
                            </bdi>
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className={cellClass}>
                    {property.titleDeed ? (
                      <StatusTag
                        entity="document_version"
                        state={property.titleDeed.reviewStatus}
                      />
                    ) : (
                      t("missing")
                    )}
                  </td>
                  <td className={cellClass}>
                    {t("approvalLine", {
                      value: t(property.ownerGate.value ? "on" : "off"),
                      source: t(`sources.${property.ownerGate.source}`),
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : query.q ? (
        <EmptyState
          variant="no-matches"
          message={t("noMatches")}
          actionLabel={t("clearFilters")}
          onAction={() => {
            router.push(base);
          }}
        />
      ) : (
        <EmptyState
          variant="no-records"
          message={t("empty")}
          actionLabel={t("add")}
          onAction={() => {
            router.push(`${base}/new`);
          }}
        />
      )}
      <EstatePagination
        base={base}
        query={query}
        nextCursor={nextCursor}
        previous={previous}
        namespace="Properties"
      />
    </div>
  );
}
