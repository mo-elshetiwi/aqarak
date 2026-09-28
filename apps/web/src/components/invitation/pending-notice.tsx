"use client";
import { useSyncExternalStore, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { readPendingInvitation } from "./pending-invitation";
function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("storage", listener);
  };
}
export function PendingInvitationNotice(): ReactElement | null {
  const locale = useLocale();
  const t = useTranslations("Auth");
  const pending = useSyncExternalStore(
    subscribe,
    () => Boolean(readPendingInvitation(locale)),
    () => false,
  );
  return pending ? (
    <p
      role="status"
      className="rounded-md border border-status-attention-border bg-status-attention-bg p-4 text-status-attention-fg"
    >
      <a
        className="underline underline-offset-4"
        href={`/${locale}/invitation`}
      >
        {t("pendingInvitation")}
      </a>
    </p>
  ) : null;
}
