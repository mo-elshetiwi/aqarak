"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ErrorState,
  NotFoundState,
  NotPermittedState,
} from "@/components/system/screen-states";
import type { Problem } from "../_lib/schemas";
export function LoadProblem({
  problem,
  namespace = "Contracts",
  message,
}: {
  problem: Problem;
  namespace?: "Contracts" | "Approvals";
  message?: string;
}): ReactElement {
  const t = useTranslations(namespace);
  const router = useRouter();
  if (problem.status === 404) return <NotFoundState />;
  if (problem.status === 403) return <NotPermittedState />;
  return (
    <ErrorState
      message={message ?? t("loadError")}
      onRetry={() => {
        router.refresh();
      }}
    />
  );
}
