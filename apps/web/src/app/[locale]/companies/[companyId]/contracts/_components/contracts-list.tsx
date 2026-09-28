"use client";
import { useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState, TableSkeleton } from "@/components/system/screen-states";
import { MoneyAmount, DateText } from "@/components/system/formatted-values";
import { StatusTag } from "@/components/system/status-tag";
import { buttonVariants } from "@/components/ui/button";
import { statusSchema, type ContractSummary } from "../_lib/schemas";
import { Label } from "@/components/ui/label";
export function ContractsList({
  items,
  nextCursor,
  canDraft,
  locale,
  companyId,
  status,
}: {
  items: ContractSummary[];
  nextCursor: string | null;
  canDraft: boolean;
  locale: Locale;
  companyId: string;
  status?: string;
}): ReactElement {
  const t = useTranslations("Contracts");
  const a = useTranslations("Approvals");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const statuses = useTranslations("Status");
  const base = `/${locale}/companies/${companyId}/contracts`;
  const nextQuery = new URLSearchParams({
    ...(nextCursor ? { cursor: nextCursor } : {}),
    ...(status ? { status } : {}),
  });
  function filter(value: string): void {
    startTransition(() => {
      router.push(value ? `${base}?status=${encodeURIComponent(value)}` : base);
    });
  }
  function create(): void {
    router.push(`${base}/new`);
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        {...(canDraft && items.length
          ? { primaryAction: { label: t("new"), onClick: create } }
          : {})}
      />
      <div className="max-w-sm space-y-2">
        <Label htmlFor="contract-status">{t("filterStatus")}</Label>
        <select
          id="contract-status"
          value={status ?? ""}
          disabled={pending}
          onChange={(event) => {
            filter(event.target.value);
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">{t("allStatuses")}</option>
          {statusSchema.options.map((value) => (
            <option key={value} value={value}>
              {statuses(`contract.${value}`)}
            </option>
          ))}
        </select>
      </div>
      {pending ? (
        <TableSkeleton />
      ) : !items.length && status ? (
        <EmptyState
          variant="no-matches"
          message={t("noMatches")}
          actionLabel={t("clearFilter")}
          onAction={() => {
            filter("");
          }}
        />
      ) : !items.length ? (
        <EmptyState
          variant="no-records"
          message={t(canDraft ? "emptyManager" : "emptyReader")}
          {...(canDraft ? { actionLabel: t("new"), onAction: create } : {})}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-body-dense">
            <thead>
              <tr>
                {[
                  "contractNo",
                  "unit",
                  "tenant",
                  "term",
                  "rent",
                  "status",
                  "nextActor",
                ].map((label) => (
                  <th
                    className="border-b p-4 text-start"
                    key={label}
                    scope="col"
                  >
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="border-b p-4">
                    <a
                      className="inline-flex min-h-6 items-center font-medium underline underline-offset-4"
                      href={`${base}/${item.id}`}
                    >
                      {item.contractNo}
                    </a>
                  </td>
                  <td className="border-b p-4">
                    {item.unit.propertyName[locale]} ·{" "}
                    <bdi>{item.unit.unitNo}</bdi>
                  </td>
                  <td className="border-b p-4">
                    <bdi>{item.tenant.name[locale]}</bdi>
                  </td>
                  <td className="border-b p-4">
                    <DateText iso={item.termStart} locale={locale} /> –{" "}
                    <DateText iso={item.termEnd} locale={locale} />
                  </td>
                  <td className="border-b p-4">
                    <MoneyAmount fils={item.annualRentFils} locale={locale} />
                  </td>
                  <td className="border-b p-4">
                    <StatusTag entity="contract" state={item.status} />
                  </td>
                  <td className="border-b p-4">
                    {item.nextActor ? a(item.nextActor) : t("noNext")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor && (
        <a
          href={`${base}?${nextQuery}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("next")}
        </a>
      )}
    </div>
  );
}
