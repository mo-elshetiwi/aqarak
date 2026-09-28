"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
function Loading(): ReactElement {
  const t = useTranslations("Tawtheeq");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-6">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-10 w-64 motion-reduce:animate-none" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full motion-reduce:animate-none" />
      ))}
    </div>
  );
}
export { Loading as default };
