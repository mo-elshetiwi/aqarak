"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/system/screen-states";
export function TenantSkeleton({
  layout,
}: {
  layout: "list" | "new" | "onboarding" | "review" | "check";
}): ReactElement {
  const t = useTranslations("Common");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-6">
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-3/4" />
      </div>
      {layout === "list" ? (
        <>
          <Skeleton className="h-9 w-32" />
          <TableSkeleton />
        </>
      ) : layout === "new" ? (
        <div aria-hidden="true" className="max-w-2xl space-y-6">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
          <Skeleton className="h-9 w-32" />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className={
            layout === "review" || layout === "onboarding"
              ? "grid gap-6 lg:grid-cols-2"
              : "space-y-6"
          }
        >
          {layout === "review" && <Skeleton className="aspect-[3/2] w-full" />}
          <div className="space-y-4 rounded-md border p-6">
            {Array.from(
              { length: layout === "onboarding" ? 3 : 10 },
              (_, row) => (
                <div key={row} className="space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ),
            )}
          </div>
          {layout === "onboarding" && (
            <div className="space-y-4 rounded-md border p-6">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-9 w-40" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
