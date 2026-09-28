"use client";
import { useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DateText, IdentifierText } from "@/components/system/formatted-values";
import { EstateMoneyAmount } from "./fils-amount";
import { StatusTag } from "@/components/system/status-tag";
import { buttonVariants } from "@/components/ui/button";
import type { OwnerDetail, PropertyDetail, UploadInput } from "../contract";
import { EstateHeader, estateBase } from "./shared";
import { DocumentProcessing, documentAction } from "./document-processing";
import { UploadPanel } from "./upload-panel";
import { DocumentAction } from "./document-action";
import { OwnerInvitation } from "./owner-invitation";
import { OnboardingTag, OwnerApproval } from "./owners-list";
export function OwnerRecord({
  owner,
  companyId,
  manager,
  saved,
  propertyRecords = [],
}: {
  owner: OwnerDetail;
  companyId: string;
  manager: boolean;
  saved: boolean | "bank" | "owner";
  propertyRecords?: PropertyDetail[];
}): ReactElement {
  const t = useTranslations("Owners");
  const [docType, setDocType] = useState<UploadInput["docType"] | null>(null);
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  const base = estateBase(locale, companyId);
  return (
    <div className="space-y-6">
      <EstateHeader
        title={owner.fullName[locale]}
        description={t("individual", {
          language: t(owner.preferredLanguage === "ar" ? "arabic" : "english"),
        })}
      />
      <p lang={locale === "ar" ? "en" : "ar"}>
        {owner.fullName[locale === "ar" ? "en" : "ar"]}
      </p>
      <div className="flex flex-wrap gap-2">
        <OnboardingTag status={owner.onboarding.status} />
        <OwnerApproval owner={owner} />
      </div>
      <OwnerSaved saved={saved} />
      {manager && (
        <a
          href={`${base}/owners/${owner.id}/edit`}
          className={buttonVariants({ variant: "secondary" })}
        >
          {t("edit")}
        </a>
      )}
      <OwnerInvitation owner={owner} companyId={companyId} manager={manager} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-md border p-6">
          <h2 className="text-h2">{t("mandate")}</h2>
          <MandateDetails owner={owner} />
          {manager && docType && (
            <UploadPanel
              companyId={companyId}
              recordId={owner.id}
              entity="owners"
              docType={docType}
              document={owner.documents.find((d) => d.docType === docType)}
              onClose={() => {
                setDocType(null);
              }}
            />
          )}
          {manager && (
            <a
              href={`${base}/owners/${owner.id}/mandate`}
              className={buttonVariants({ variant: "secondary" })}
            >
              {t(owner.mandate ? "editMandate" : "recordMandate")}
            </a>
          )}
        </section>
        <section className="space-y-4 rounded-md border p-6">
          <h2 className="text-h2">{t("onboardingDocuments")}</h2>
          <OwnerDocuments
            owner={owner}
            companyId={companyId}
            manager={manager}
            onOpen={setDocType}
          />
          <OwnerPropertyDocuments
            owner={owner}
            manager={manager}
            companyId={companyId}
            records={propertyRecords}
          />
        </section>
        <section className="space-y-4 rounded-md border p-6">
          <h2 className="text-h2">{t("properties")}</h2>
          {owner.properties.length ? (
            <ul className="space-y-3">
              {owner.properties.map((property) => (
                <li key={property.id}>
                  <a
                    className="underline"
                    href={`${base}/properties/${property.id}`}
                  >
                    {property.name[locale]}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("noProperties")}</p>
          )}
        </section>
        <OwnerContact owner={owner} />
        <OwnerBank owner={owner} manager={manager} base={base} />
      </div>
      {manager && (
        <section className="space-y-4">
          <h2 className="text-h2">{t("history")}</h2>
          {owner.history.length ? (
            <ol className="space-y-4 border-s ps-4">
              {owner.history.map((entry, index) => (
                <li key={index}>
                  <p className="text-body-strong">{t("historyEvent")}</p>
                  <p>
                    {entry.actorDisplayName ?? t("unknownPerson")} ·{" "}
                    <DateText iso={entry.occurredAt} locale={locale} />
                  </p>
                  {entry.reason && <p>{entry.reason}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("noHistory")}</p>
          )}
        </section>
      )}
    </div>
  );
}
function MandateDetails({ owner }: { owner: OwnerDetail }): ReactElement {
  const t = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  const mandate = owner.mandate;
  if (!mandate) return <p>{t("notRecorded")}</p>;
  return (
    <dl className="grid grid-cols-2 gap-4">
      <dt>{t("approval")}</dt>
      <dd>
        <OwnerApproval owner={owner} />
      </dd>
      <dt>{t("costThreshold")}</dt>
      <dd>
        {mandate.costThresholdFils === null ? (
          t("notRecorded")
        ) : (
          <EstateMoneyAmount fils={mandate.costThresholdFils} locale={locale} />
        )}
      </dd>
      <dt>{t("fee")}</dt>
      <dd>
        {mandate.feeBp === null ? (
          t("notRecorded")
        ) : (
          <bdi dir="ltr">
            {t("feeValue", { value: String(mandate.feeBp / 100) })}
          </bdi>
        )}
      </dd>
      <dt>{t("period")}</dt>
      <dd>
        <DateText iso={mandate.startsOn} locale={locale} /> ·{" "}
        {mandate.endsOn ? (
          <DateText iso={mandate.endsOn} locale={locale} />
        ) : (
          t("openEnded")
        )}
      </dd>
      <dt>{t("covered")}</dt>
      <dd>
        {owner.properties
          .filter((p) => mandate.propertyIds.includes(p.id))
          .map((p) => p.name[locale])
          .join(locale === "ar" ? "، " : ", ") || t("noProperties")}
      </dd>
    </dl>
  );
}
function OwnerDocuments({
  owner,
  companyId,
  manager,
  onOpen,
}: {
  owner: OwnerDetail;
  manager: boolean;
  onOpen: (type: UploadInput["docType"]) => void;
  companyId: string;
}): ReactElement {
  const t = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  return (
    <ul className="divide-y">
      {(
        [
          "emirates_id",
          "passport",
          "management_agreement",
          "tawtheeq_authorisation",
        ] as const
      ).map((type) => {
        const doc = owner.documents.find((d) => d.docType === type);
        const version = doc?.latest ?? doc?.current;
        return (
          <li
            className="flex flex-wrap items-center justify-between gap-3 py-3"
            key={type}
          >
            <span>{t(`documents.${type}`)}</span>
            {version ? (
              <span className="flex flex-wrap gap-2">
                <DocumentProcessing version={version} namespace="Owners" />
                <StatusTag
                  entity="document_version"
                  state={version.reviewStatus}
                />
                {version.expiryDate && (
                  <DateText iso={version.expiryDate} locale={locale} />
                )}
              </span>
            ) : (
              t("missing")
            )}
            {manager && (
              <DocumentAction
                companyId={companyId}
                recordId={owner.id}
                entity="owners"
                docType={type}
                document={doc}
                variant="link"
                onOpen={() => {
                  onOpen(type);
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function OwnerPropertyDocuments({
  owner,
  manager,
  companyId,
  records,
}: {
  owner: OwnerDetail;
  manager: boolean;
  companyId: string;
  records: PropertyDetail[];
}): ReactElement {
  const t = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  return (
    <div className="space-y-3 border-t pt-3">
      <p>{t("propertyDocuments")}</p>
      {owner.properties.length ? (
        owner.properties.map((property) => {
          const record = records.find((item) => item.id === property.id);
          const document = record?.documents.find(
            (item) =>
              item.docType === "title_deed" || item.docType === "site_plan",
          );
          const version = document?.latest ?? document?.current;
          return (
            <div
              key={property.id}
              className="flex flex-wrap items-center gap-3"
            >
              <span>{property.name[locale]}</span>
              {version && (
                <>
                  <DocumentProcessing version={version} namespace="Owners" />
                  <StatusTag
                    entity="document_version"
                    state={version.reviewStatus}
                  />
                </>
              )}
              {manager && (
                <a
                  className="underline"
                  href={`${estateBase(locale, companyId)}/properties/${property.id}?document=${document?.docType ?? "title_deed"}`}
                >
                  {t(documentAction(version))}
                </a>
              )}
            </div>
          );
        })
      ) : (
        <p>{t("noProperties")}</p>
      )}
    </div>
  );
}

function OwnerContact({ owner }: { owner: OwnerDetail }): ReactElement {
  const t = useTranslations("Owners");
  return (
    <section className="space-y-4 rounded-md border p-6">
      <h2 className="text-h2">{t("contact")}</h2>
      <dl className="grid grid-cols-2 gap-3">
        <dt>{t("email")}</dt>
        <dd>
          <bdi dir="ltr">{owner.email ?? t("notProvided")}</bdi>
        </dd>
        <dt>{t("phoneE164")}</dt>
        <dd>
          <bdi dir="ltr">{owner.phoneE164 ?? t("notProvided")}</bdi>
        </dd>
        <dt>{t("documents.emirates_id")}</dt>
        <dd>
          {owner.eidNumberMasked ? (
            <IdentifierText value={owner.eidNumberMasked} kind="emirates_id" />
          ) : (
            t("notProvided")
          )}
        </dd>
      </dl>
    </section>
  );
}

function OwnerBank({
  owner,
  manager,
  base,
}: {
  owner: OwnerDetail;
  manager: boolean;
  base: string;
}): ReactElement {
  const t = useTranslations("Owners");
  return (
    <section className="space-y-4 rounded-md border p-6">
      <h2 className="text-h2">{t("bankDetails")}</h2>
      {owner.bank ? (
        <dl className="grid grid-cols-2 gap-3">
          <dt>{t("bankName")}</dt>
          <dd>{owner.bank.bankName ?? t("notProvided")}</dd>
          <dt>{t("accountHolder")}</dt>
          <dd>{owner.bank.accountHolder ?? t("notProvided")}</dd>
          <dt>{t("ibanLast4")}</dt>
          <dd>
            <bdi dir="ltr">{owner.bank.ibanLast4 ?? t("notProvided")}</bdi>
          </dd>
        </dl>
      ) : (
        <p>{t("notRecorded")}</p>
      )}
      {manager && (
        <a
          href={`${base}/owners/${owner.id}/bank-details`}
          className={buttonVariants({ variant: "secondary" })}
        >
          {t("recordBankDetails")}
        </a>
      )}
    </section>
  );
}

function OwnerSaved({
  saved,
}: {
  saved: boolean | "bank" | "owner";
}): ReactElement {
  const t = useTranslations("Owners");
  return (
    <div aria-live="polite">
      {saved &&
        t(
          saved === "bank"
            ? "bankSaved"
            : saved === "owner"
              ? "ownerSaved"
              : "mandateSaved",
        )}
    </div>
  );
}
