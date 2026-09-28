"use client";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ErrorState,
  NotFoundState,
  NotPermittedState,
} from "@/components/system/screen-states";
import type { Problem } from "../_lib/j3-contract";
export function PageProblem({ code }: Problem): ReactElement {
  const router = useRouter();
  const t = useTranslations("Documents");
  if (code === "NOT_FOUND") return <NotFoundState />;
  if (code === "FORBIDDEN") return <NotPermittedState />;
  return (
    <ErrorState
      message={t(`errors.${code}`)}
      onRetry={() => {
        router.refresh();
      }}
    />
  );
}
