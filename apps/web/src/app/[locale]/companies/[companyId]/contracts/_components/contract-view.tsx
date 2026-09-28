"use client";
import { useState, type ReactElement } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { ApprovalTimeline } from "@/components/approval/approval-timeline";
import {
  MoneyAmount,
  DateText,
  IdentifierText,
} from "@/components/system/formatted-values";
import { PageHeader } from "@/components/system/page-header";
import { FieldError } from "@/components/system/screen-states";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusTag } from "@/components/system/status-tag";
import { DeliveryLog } from "./delivery-log";
import { DecisionPanel } from "./decision-panel";
import { approvalSteps, hashPrefix } from "../_lib/view-helpers";
import type { ContractDetail } from "../_lib/schemas";
export interface ContractViewProps {
  detail: ContractDetail;
  locale: Locale;
  companyId: string;
  csrfToken: string;
  now: string;
  editor?: ReactElement;
  comparison?: ReactElement;
}
export function ContractView({
  detail: d,
  locale,
  companyId,
  csrfToken,
  now,
  editor,
  comparison,
}: ContractViewProps): ReactElement {
  const t = useTranslations("Contracts");
  const a = useTranslations("Approvals");
  const [scheduleError, setScheduleError] = useState(false);
  const steps = approvalSteps(d, locale, a("manager"));
  return (
    <div className="space-y-8" dir={locale === "ar" ? "rtl" : "ltr"}>
      <PageHeader
        title={t("detailTitle", { number: d.contract.contractNo })}
        description={`${d.property.name[locale]} · ${d.unit.unitNo}`}
      />
      <div
        className="flex flex-wrap items-center gap-4"
        role="status"
        aria-live="polite"
      >
        <StatusTag entity="contract" state={d.contract.status} />
        <VersionHash detail={d} />
      </div>
      <NextIntlClientProvider locale={locale === "ar" ? "ar-u-nu-latn" : "en"}>
        <ApprovalTimeline
          steps={steps}
          ownerGate={d.ownerGate.value}
          now={now}
          {...(d.viewer.slot === "reader" ? {} : { viewerSlot: d.viewer.slot })}
          version={{
            number: d.version.versionNo,
            hashPrefix: hashPrefix(d.version.contentHash),
          }}
        />
      </NextIntlClientProvider>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section
            className="space-y-4 rounded-lg border bg-card p-6"
            aria-labelledby="terms-heading"
          >
            <h2 id="terms-heading" className="text-h2">
              {t("keyTerms")}
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Term label={t("tenant")}>
                <bdi>{d.tenant.name[locale]}</bdi>
              </Term>
              <Term label={t("owner")}>
                <bdi>{d.owner?.name[locale] ?? a("unknown")}</bdi>
              </Term>
              <Term label={t("termStart")}>
                <DateText iso={d.version.termStart} locale={locale} />
              </Term>
              <Term label={t("termEnd")}>
                <DateText iso={d.version.termEnd} locale={locale} />
              </Term>
              <Term label={t("totalFils")}>
                <MoneyAmount fils={d.version.totalFils} locale={locale} />
              </Term>
              <Term label={t("depositFils")}>
                <MoneyAmount fils={d.version.depositFils} locale={locale} />
              </Term>
            </dl>
            <p className="text-caption text-muted-foreground">
              {t("fixedTemplate")}
            </p>
            {d.version.submittedAt && <p>{t("frozen")}</p>}
          </section>
          {editor}
          <InstalmentTerms
            detail={d}
            locale={locale}
            scheduleError={scheduleError}
          />
          {d.contract.cancelReason && (
            <section className="space-y-2 rounded-lg border p-6">
              <h2 className="text-h2">{t("cancelReason")}</h2>
              <p className="whitespace-pre-wrap">{d.contract.cancelReason}</p>
            </section>
          )}
          {d.predecessor && (
            <a
              className="inline-flex min-h-6 items-center underline"
              href={`/${locale}/companies/${companyId}/contracts/${d.predecessor.id}`}
            >
              {t("predecessor")} · {d.predecessor.contractNo}
            </a>
          )}
          {d.contract.successorId && (
            <a
              className="inline-flex min-h-6 items-center underline"
              href={`/${locale}/companies/${companyId}/contracts/${d.contract.successorId}`}
            >
              {t("successor")}
            </a>
          )}
        </div>
        <DecisionPanel
          detail={d}
          locale={locale}
          companyId={companyId}
          csrfToken={csrfToken}
          onFailure={(failure) => {
            setScheduleError(failure?.code === "SCHEDULE_TOTAL_MISMATCH");
          }}
        />
      </div>
      {comparison}
      <ContractDocuments detail={d} locale={locale} />
      <DeliveryLog detail={d} locale={locale} />
    </div>
  );
}
function Term({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="space-y-1">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function VersionHash({
  detail,
}: {
  detail: ContractDetail;
}): ReactElement {
  const t = useTranslations("Contracts");
  return (
    <IdentifierText
      kind="prp"
      value={t("version", {
        version: detail.version.versionNo,
        hash: hashPrefix(detail.version.contentHash),
      })}
    />
  );
}
function InstalmentTerms({
  detail,
  locale,
  scheduleError,
}: {
  detail: ContractDetail;
  locale: Locale;
  scheduleError: boolean;
}): ReactElement {
  const t = useTranslations("Contracts");
  return (
    <section
      id="contract-instalments"
      tabIndex={-1}
      className="space-y-4 rounded-lg border bg-card p-6"
    >
      <h2 className="text-h2">{t("instalments")}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-body-dense">
          <thead>
            <tr>
              {["seqNo", "dueOn", "chequeNo", "bankName", "amountFils"].map(
                (key) => (
                  <th key={key} scope="col" className="border-b p-3 text-start">
                    {t(key)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {detail.version.instalments.map((row) => (
              <tr key={row.seqNo}>
                <td className="border-b p-3">{row.seqNo}</td>
                <td className="border-b p-3">
                  <DateText iso={row.dueOn} locale={locale} />
                </td>
                <td className="border-b p-3">
                  {row.cheque && (
                    <IdentifierText kind="cheque" value={row.cheque.chequeNo} />
                  )}
                </td>
                <td className="border-b p-3">{row.cheque?.bankName}</td>
                <td className="border-b p-3">
                  <MoneyAmount fils={row.amountFils} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scheduleError && (
        <FieldError
          id="contract-instalments-error"
          message={t("errors.SCHEDULE_TOTAL_MISMATCH")}
        />
      )}
    </section>
  );
}
function Evidence({
  detail,
  locale,
}: {
  detail: ContractDetail;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Approvals");
  const c = useTranslations("Contracts");
  const decisions = detail.approvals.filter((item) => item.decidedAt !== null);
  return (
    <section
      className="space-y-4 rounded-lg border bg-card p-6"
      aria-labelledby="evidence-heading"
    >
      <h2 id="evidence-heading" className="text-h2">
        {t("evidence")}
      </h2>
      <div className="overflow-x-auto">
        <table
          aria-labelledby="evidence-heading"
          className="w-full text-start text-body-dense"
        >
          <thead>
            <tr>
              {[
                "step",
                "person",
                "decision",
                "hash",
                "time",
                "channelDevice",
                "session",
              ].map((key) => (
                <th className="border-b p-3 text-start" key={key} scope="col">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {decisions.map((item) => (
              <tr key={item.id}>
                <td className="border-b p-3">{t(item.slot)}</td>
                <td className="border-b p-3">
                  <bdi>
                    {item.slot === "owner"
                      ? detail.owner?.name[locale]
                      : item.slot === "tenant"
                        ? detail.tenant.name[locale]
                        : item.personName}
                  </bdi>
                </td>
                <td className="border-b p-3">
                  {t(item.status)}
                  {item.reason && (
                    <p className="mt-2 whitespace-pre-wrap">{item.reason}</p>
                  )}
                </td>
                <td className="whitespace-nowrap border-b p-3">
                  <IdentifierText
                    kind="prp"
                    value={c("version", {
                      version: detail.version.versionNo,
                      hash: hashPrefix(item.subjectHash),
                    })}
                  />
                </td>
                <td className="border-b p-3">
                  {item.decidedAt && (
                    <>
                      <DateText iso={item.decidedAt} locale={locale} />
                      <span className="ms-2">
                        <bdi dir="ltr">
                          {new Intl.DateTimeFormat(`${locale}-AE-u-nu-latn`, {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Dubai",
                          }).format(new Date(item.decidedAt))}
                        </bdi>
                      </span>
                    </>
                  )}
                </td>
                <td className="border-b p-3">
                  {item.channel === "web" || item.channel === "web_form"
                    ? t("web")
                    : (item.channel ?? t("unknown"))}{" "}
                  ·{" "}
                  {item.device === "browser"
                    ? t("browser")
                    : (item.device ?? t("unknown"))}
                </td>
                <td className="border-b p-3">
                  {item.channel ? t("ownSession") : t("unknown")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="text-h3">{t("whatProves")}</h3>
      <p className="max-w-prose text-body-dense">
        {t(
          detail.contract.status === "concluded"
            ? detail.ownerGate.value
              ? "proof"
              : "proofTwo"
            : "proofPending",
        )}
      </p>
    </section>
  );
}

function ContractDocuments({
  detail,
  locale,
}: {
  detail: ContractDetail;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Contracts");
  const a = useTranslations("Approvals");
  const hasDecisions = detail.approvals.some((item) => item.decidedAt !== null);
  return (
    <Tabs
      key={`${detail.contract.id}:${detail.contract.status}`}
      className="flex-col"
      defaultValue={
        detail.contract.status === "concluded" ? "evidence" : "preview"
      }
    >
      <TabsList aria-label={t("preview")} className="h-10 flex-row">
        <TabsTrigger value="preview">{t("preview")}</TabsTrigger>
        {hasDecisions && (
          <TabsTrigger value="evidence">{a("evidence")}</TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="preview" className="min-w-0 w-full pt-4">
        <BilingualPreview detail={detail} />
      </TabsContent>
      {hasDecisions && (
        <TabsContent value="evidence" className="min-w-0 w-full pt-4">
          <Evidence detail={detail} locale={locale} />
        </TabsContent>
      )}
    </Tabs>
  );
}
function BilingualPreview({
  detail: d,
}: {
  detail: ContractDetail;
}): ReactElement {
  const t = useTranslations("Contracts");
  return (
    <section className="space-y-4" aria-labelledby="preview-heading">
      <h2 id="preview-heading" className="text-h2">
        {t("preview")}
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {(["en", "ar"] as const).map((language) => (
          <article
            key={language}
            lang={language}
            dir={language === "ar" ? "rtl" : "ltr"}
            className="space-y-5 rounded-lg border bg-card p-6"
          >
            <p className="text-caption text-muted-foreground">
              {t(language === "en" ? "english" : "arabic")}
            </p>
            <h3 className="text-h3">{d.rendered[language].title}</h3>
            {d.rendered[language].sections.map((section) => (
              <section
                key={section.number}
                className={
                  section.special
                    ? "space-y-2 rounded-md border border-status-attention-border bg-status-attention-bg p-4 text-status-attention-fg"
                    : "space-y-2"
                }
              >
                <h4 className="text-body-strong">
                  <bdi>{section.number}</bdi>
                  {" · "}
                  {section.heading}
                </h4>
                <p className="whitespace-pre-wrap text-body-dense">
                  {section.body}
                </p>
                {language === "ar" && section.special && (
                  <StoredClauseProvenance
                    detail={d}
                    sectionNumber={section.number}
                  />
                )}
              </section>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

function StoredClauseProvenance({
  detail,
  sectionNumber,
}: {
  detail: ContractDetail;
  sectionNumber: number;
}): ReactElement | null {
  const t = useTranslations("Contracts");
  const position =
    detail.rendered.ar.sections
      .filter((section) => section.special)
      .findIndex((section) => section.number === sectionNumber) + 1;
  const suggestion = detail.version.specialClauses.find(
    (clause) => clause.position === position,
  )?.suggestion;
  if (!suggestion) return null;
  return (
    <p className="text-caption text-ai-fg">
      {t("suggestion.label")} · <bdi>{suggestion.registryEntry}</bdi> ·{" "}
      {t("suggestion.prompt")}: <bdi>{suggestion.promptVersion}</bdi> ·{" "}
      {t(
        suggestion.confirmation === "ai_confirmed"
          ? "suggestion.confirmed"
          : "suggestion.edited",
      )}
    </p>
  );
}
