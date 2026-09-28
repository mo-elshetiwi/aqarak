"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
interface LoadingProps {
  geometry: "owners" | "properties" | "owner" | "property" | "form" | "units";
}
function TableGeometry({ columns }: { columns: number }): ReactElement {
  return (
    <div className="overflow-x-auto rounded-md border">
      {Array.from({ length: 6 }, (_, row) => (
        <div
          key={row}
          className="flex h-11 items-center gap-4 border-b ps-3 pe-3 last:border-b-0"
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className="h-4 min-w-16 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
function FormGeometry(): ReactElement {
  return (
    <div className="grid max-w-4xl gap-6 sm:grid-cols-2">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32" />
    </div>
  );
}
function RecordGeometry({ property }: { property: boolean }): ReactElement {
  return (
    <div
      className={
        property
          ? "grid gap-6 lg:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]"
          : "grid gap-6 lg:grid-cols-2"
      }
    >
      <div className="space-y-6 rounded-md border p-6">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex justify-between gap-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
      {property ? (
        <TableGeometry columns={6} />
      ) : (
        <div className="space-y-6 rounded-md border p-6">
          <Skeleton className="h-6 w-48" />
          <TableGeometry columns={2} />
        </div>
      )}
    </div>
  );
}
export function EstateLoading({ geometry }: LoadingProps): ReactElement {
  const t = useTranslations("Common");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-6">
      <h1 className="sr-only">{t("loading")}</h1>
      <div aria-hidden="true" className="space-y-6">
        <div className="flex justify-between gap-6">
          <div className="w-2/3 space-y-3">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <LoadingBody geometry={geometry} />
      </div>
    </div>
  );
}
function LoadingBody({ geometry }: LoadingProps): ReactElement {
  if (geometry === "form" || geometry === "units") return <FormGeometry />;
  if (geometry === "owner" || geometry === "property")
    return <RecordGeometry property={geometry === "property"} />;
  return (
    <>
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1" />
        {geometry === "owners" && (
          <>
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-10 w-36" />
          </>
        )}
      </div>
      <TableGeometry columns={geometry === "owners" ? 7 : 6} />
    </>
  );
}
