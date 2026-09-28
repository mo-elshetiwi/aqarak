"use client";
import { useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { Button } from "@/components/ui/button";
import { DateText } from "@/components/system/formatted-values";
import { ErrorState } from "@/components/system/screen-states";
import type {
  ApprovalItem,
  ContractNotification,
  ProblemCode,
} from "../../contracts/_lib/schemas";
import { randomCommandKey } from "../../contracts/_lib/view-helpers";
import { notificationLabel } from "../../contracts/_lib/notification-label";
import { markRead } from "../_lib/actions";
export function ApprovalsQueue({
  items,
  notifications,
  locale,
  companyId,
  csrfToken,
  now,
  notificationsLoaded = true,
  approvalsLoaded = true,
}: {
  items: ApprovalItem[];
  notifications: ContractNotification[];
  locale: Locale;
  companyId: string;
  csrfToken: string;
  now: string;
  notificationsLoaded?: boolean;
  approvalsLoaded?: boolean;
}): ReactElement {
  const t = useTranslations("Approvals");
  const router = useRouter();
  const base = `/${locale}/companies/${companyId}/contracts`;
  const sorted = [...notifications].sort(
    (a, b) =>
      Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <>
      {approvalsLoaded &&
        (!items.length ? (
          <div className="space-y-4 rounded-lg border p-6">
            <p>{t("empty")}</p>
            <Button
              variant="outline"
              onClick={() => {
                router.refresh();
              }}
            >
              {t("refresh")}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table
              className="w-full whitespace-nowrap text-body-dense"
              aria-label={t("title")}
            >
              <thead>
                <tr>
                  {[
                    "contract",
                    "unitProperty",
                    "version",
                    "submittedBy",
                    "age",
                    "slot",
                  ].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="h-11 border-b px-3 text-start"
                    >
                      {t(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.approvalId} className="h-11">
                    <td className="border-b px-3">
                      <a
                        className="inline-flex min-h-6 items-center underline underline-offset-4"
                        href={`${base}/${item.contractId}`}
                      >
                        {item.contractNo}
                      </a>
                    </td>
                    <td className="border-b px-3">
                      {item.unit.propertyName[locale]} ·{" "}
                      <bdi>{item.unit.unitNo}</bdi>
                    </td>
                    <td className="border-b px-3">
                      <bdi>{item.versionNo}</bdi>
                    </td>
                    <td className="border-b px-3">
                      <bdi>{item.submittedBy}</bdi>
                    </td>
                    <td className="border-b px-3">
                      <time dateTime={item.requestedAt}>
                        {t("ageDays", {
                          days: String(
                            Math.max(
                              0,
                              Math.floor(
                                (Date.parse(now) -
                                  Date.parse(item.requestedAt)) /
                                  86400000,
                              ),
                            ),
                          ),
                        })}
                      </time>
                    </td>
                    <td className="border-b px-3">{t(item.slot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <section className="space-y-4" aria-labelledby="notifications-heading">
        <h2 className="text-h2" id="notifications-heading">
          {t("notifications")}
        </h2>
        {notificationsLoaded && !sorted.length && <p>{t("noNotifications")}</p>}
        <ul className="divide-y rounded-lg border bg-card">
          {sorted.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-4 p-3">
              <span className="text-caption-strong">
                {t(item.readAt ? "read" : "unread")}
              </span>
              {item.contractId ? (
                <a
                  className="min-h-6 underline underline-offset-4"
                  href={`${base}/${item.contractId}`}
                >
                  {t(notificationLabel(item.templateCode))}
                </a>
              ) : (
                <span>{t(notificationLabel(item.templateCode))}</span>
              )}
              <DateText iso={item.createdAt} locale={locale} />
              <ReadButton
                item={item}
                locale={locale}
                companyId={companyId}
                csrfToken={csrfToken}
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
function ReadButton({
  item,
  locale,
  companyId,
  csrfToken,
}: {
  item: ContractNotification;
  locale: Locale;
  companyId: string;
  csrfToken: string;
}): ReactElement {
  const t = useTranslations("Approvals");
  const c = useTranslations("Contracts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<ProblemCode | null>(null);
  const [read, setRead] = useState(Boolean(item.readAt));
  function readNotice(): void {
    if (pending || read) return;
    const idempotencyKey = randomCommandKey();
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await markRead({
          locale,
          companyId,
          csrfToken,
          idempotencyKey,
          input: { notificationId: item.id },
        });
        if (!result.ok) {
          setFailure(result.code);
          return;
        }
        setRead(true);
        router.refresh();
      } catch {
        setFailure("UNAVAILABLE");
      }
    });
  }
  return (
    <div className="ms-auto space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={readNotice}
        disabled={pending || read}
      >
        {t(pending ? "markingRead" : read ? "read" : "markRead")}
      </Button>
      {failure && (
        <ErrorState message={c(`errors.${failure}`)} onRetry={readNotice} />
      )}
    </div>
  );
}
