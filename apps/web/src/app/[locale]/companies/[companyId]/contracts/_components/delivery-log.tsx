"use client";
import type { ReactElement } from "react";
import type { Locale } from "@aqarak/i18n";
import { useTranslations } from "next-intl";
import { CircleCheck, Clock, TriangleAlert, CircleDashed } from "lucide-react";
import { DateText } from "@/components/system/formatted-values";
import { notificationLabel } from "../_lib/notification-label";
import type { ContractDetail } from "../_lib/schemas";
type Delivery = ContractDetail["deliveries"][number];
export function DeliveryLog({
  detail,
  locale,
}: {
  detail: ContractDetail;
  locale: Locale;
}): ReactElement | null {
  const t = useTranslations("Contracts");
  const a = useTranslations("Approvals");
  if (detail.viewer.slot !== "manager") return null;
  return (
    <section className="space-y-4" aria-labelledby="delivery-heading">
      <h2 id="delivery-heading" className="text-h2">
        {t("delivery.title")}
      </h2>
      {!detail.deliveries.length ? (
        <p>{t("delivery.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table
            className="w-full text-body-dense"
            aria-labelledby="delivery-heading"
          >
            <thead>
              <tr>
                {["recipient", "channel", "notice", "status", "time"].map(
                  (key) => (
                    <th
                      scope="col"
                      key={key}
                      className="border-b px-3 py-2 text-start"
                    >
                      {t(`delivery.${key}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {detail.deliveries.map((item) => (
                <tr key={item.notificationId}>
                  <td className="border-b px-3 py-2">
                    <bdi>{item.recipientName}</bdi>
                  </td>
                  <td className="border-b px-3 py-2">
                    {t(
                      item.channel === "email"
                        ? "delivery.email"
                        : item.channel === "in_app"
                          ? "delivery.inApp"
                          : "delivery.other",
                    )}
                  </td>
                  <td className="border-b px-3 py-2">
                    {a(notificationLabel(item.templateCode))}
                  </td>
                  <td className="space-y-2 border-b px-3 py-2">
                    <DeliveryStatus status={item.status} />
                    {item.channel === "email" &&
                      (item.status === "failed" ||
                        item.status === "dead_lettered") && (
                        <>
                          <p>
                            {t(deliveryFailure(item), {
                              attempts: String(item.attempts),
                            })}
                          </p>
                          {item.lastErrorCode === "MessageRejected" && (
                            <p>{t("delivery.addressUnverified")}</p>
                          )}
                          <p>
                            {t(
                              inAppDelivered(detail.deliveries, item)
                                ? "delivery.inAppDelivered"
                                : "delivery.inAppUnknown",
                            )}
                          </p>
                        </>
                      )}
                  </td>
                  <td className="whitespace-nowrap border-b px-3 py-2">
                    <DateText iso={item.createdAt} locale={locale} /> ·{" "}
                    <bdi>
                      {new Intl.DateTimeFormat(`${locale}-AE-u-nu-latn`, {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Dubai",
                      }).format(new Date(item.createdAt))}
                    </bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function inAppDelivered(items: Delivery[], email: Delivery): boolean {
  return items.some(
    (item) =>
      item.channel === "in_app" &&
      item.recipientName === email.recipientName &&
      item.templateCode === email.templateCode &&
      item.createdAt === email.createdAt &&
      ["sent", "delivered"].includes(item.status),
  );
}
function deliveryFailure(item: Delivery): string {
  if (item.deadLettered) return "delivery.exhausted";
  return "delivery.retrying";
}
function DeliveryStatus({ status }: { status: string }): ReactElement {
  const t = useTranslations("Contracts");
  const kind = ["sent", "delivered"].includes(status)
    ? "sent"
    : ["failed", "dead_lettered"].includes(status)
      ? "failed"
      : ["queued", "pending", "sending"].includes(status)
        ? "queued"
        : "unknown";
  const classes = {
    sent: "border-status-success-border bg-status-success-bg text-status-success-fg",
    failed:
      "border-status-danger-border bg-status-danger-bg text-status-danger-fg",
    queued:
      "border-status-progress-border bg-status-progress-bg text-status-progress-fg",
    unknown:
      "border-status-neutral-border bg-status-neutral-bg text-status-neutral-fg",
  };
  const Icon = {
    sent: CircleCheck,
    failed: TriangleAlert,
    queued: Clock,
    unknown: CircleDashed,
  }[kind];
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-caption-strong ${classes[kind]}`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {t(`delivery.${kind}`)}
    </span>
  );
}
