"use client";
import type { ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/system/screen-states";
import { DateText } from "@/components/system/formatted-values";
import { Button } from "@/components/ui/button";
import type { OwnerListItem, OwnerQuery } from "../contract";
import { EstatePagination } from "./pagination";
import { EstateHeader, cellClass, controlClass, estateBase } from "./shared";
export function OwnerApproval({
  owner,
}: {
  owner: Pick<OwnerListItem, "ownerGate">;
}): ReactElement {
  const t = useTranslations("Owners");
  const gate = owner.ownerGate;
  const key =
    gate.source === "self_managed"
      ? "selfManaged"
      : !gate.recorded
        ? "notRecorded"
        : gate.value
          ? "onChosen"
          : "offChosen";
  return (
    <span className="inline-flex rounded-sm border bg-status-neutral-bg ps-2 pe-2 text-caption-strong text-status-neutral-fg">
      {t(`gate.${key}`)}
    </span>
  );
}
export function OnboardingTag({
  status,
}: {
  status: OwnerListItem["onboarding"];
}): ReactElement {
  const t = useTranslations("Owners");
  return (
    <span className="inline-flex rounded-sm border bg-status-neutral-bg ps-2 pe-2 text-caption-strong text-status-neutral-fg">
      {t(`onboarding.${status}`)}
    </span>
  );
}
export function OwnersList({
  items,
  companyId,
  query,
  nextCursor,
  previous = [],
}: {
  items: OwnerListItem[];
  companyId: string;
  query: OwnerQuery;
  nextCursor: string | null;
  previous?: string[];
}): ReactElement {
  const t = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  const router = useRouter();
  const base = `${estateBase(locale, companyId)}/owners`;
  const filtered = [
    query.q,
    query.onboarding,
    query.gate,
    query.mandateExpiring,
  ].some(Boolean);
  return (
    <div className="space-y-6">
      <EstateHeader
        title={t("title")}
        description={t("description")}
        {...(items.length ? { href: `${base}/new`, action: t("add") } : {})}
      />
      <form
        action={base}
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="min-w-48 flex-1 space-y-2">
          {t("search")}
          <input name="q" defaultValue={query.q} className={controlClass} />
        </label>
        <label className="space-y-2">
          {t("onboardingLabel")}
          <select
            name="onboarding"
            defaultValue={query.onboarding ?? ""}
            className={controlClass}
          >
            <option value="">{t("all")}</option>
            {(
              ["invited", "incomplete", "pending_review", "verified"] as const
            ).map((value) => (
              <option key={value} value={value}>
                {t(`onboarding.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          {t("approval")}
          <select
            name="gate"
            defaultValue={query.gate ?? ""}
            className={controlClass}
          >
            <option value="">{t("all")}</option>
            <option value="on">{t("on")}</option>
            <option value="off">{t("off")}</option>
            <option value="not_recorded">{t("notRecorded")}</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="mandateExpiring"
            value="true"
            defaultChecked={query.mandateExpiring === "true"}
          />
          {t("mandateExpiring")}
        </label>
        <Button type="submit" variant="secondary">
          {t("searchSubmit")}
        </Button>
      </form>
      {!items.length ? (
        filtered ? (
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
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  "owner",
                  "properties",
                  "approval",
                  "documents.management_agreement",
                  "documents.tawtheeq_authorisation",
                  "onboardingLabel",
                  "language",
                ].map((key) => (
                  <th key={key} scope="col" className={cellClass}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((owner) => (
                <tr key={owner.id}>
                  <td className={cellClass}>
                    <a
                      className="flex items-center gap-2 underline-offset-4 hover:underline"
                      href={`${base}/${owner.id}`}
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-caption"
                      >
                        {owner.fullName.en
                          .split(" ")
                          .slice(0, 2)
                          .map((s) => s[0])
                          .join("")}
                      </span>
                      <span>
                        <span className="block text-body-strong" lang="en">
                          {owner.fullName.en}
                        </span>
                        <span
                          className="block text-caption text-muted-foreground"
                          lang="ar"
                          dir="rtl"
                        >
                          {owner.fullName.ar}
                        </span>
                      </span>
                    </a>
                  </td>
                  <td className={cellClass}>
                    {owner.properties
                      .map((p) => p.name[locale])
                      .join(locale === "ar" ? "، " : ", ") || t("missing")}
                  </td>
                  <td className={cellClass}>
                    <OwnerApproval owner={owner} />
                  </td>
                  {[owner.managementAgreement, owner.tawtheeqAuthorisation].map(
                    (doc, index) => (
                      <td className={cellClass} key={index}>
                        {doc?.expiryDate ? (
                          <DateText iso={doc.expiryDate} locale={locale} />
                        ) : (
                          t("missing")
                        )}
                      </td>
                    ),
                  )}
                  <td className={cellClass}>
                    <OnboardingTag status={owner.onboarding} />
                  </td>
                  <td className={cellClass}>
                    {t(owner.preferredLanguage === "ar" ? "arabic" : "english")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EstatePagination
        base={base}
        query={query}
        nextCursor={nextCursor}
        previous={previous}
        namespace="Owners"
      />
      <p className="text-caption text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
