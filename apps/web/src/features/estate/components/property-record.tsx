"use client";
import { useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { IdentifierText, DateText } from "@/components/system/formatted-values";
import { StatusTag } from "@/components/system/status-tag";
import {
  propertyDocTypeSchema,
  localeSchema,
  type PropertyDetail,
  type UploadInput,
} from "../contract";
import { EstateHeader, estateBase } from "./shared";
import { EstateHistory } from "./history";
import { UnitsTable } from "./units";
import { DocumentAction } from "./document-action";
import { DocumentProcessing } from "./document-processing";
import { UploadPanel } from "./upload-panel";
export function PropertyRecord({
  property,
  companyId,
  initialDocument,
  manager = true,
  saved = false,
}: {
  property: PropertyDetail;
  manager?: boolean;
  saved?: boolean;
  companyId: string;
  initialDocument?: UploadInput["docType"] | undefined;
}): ReactElement {
  const t = useTranslations("Properties");
  const locale = localeSchema.parse(useLocale());
  const base = estateBase(locale, companyId);
  const [selected, setSelected] = useState<UploadInput["docType"] | null>(
    initialDocument ?? null,
  );
  return (
    <div className="space-y-6">
      <EstateHeader
        title={property.name[locale]}
        description={[
          property.area?.[locale],
          property.use ? t(`uses.${property.use}`) : t("notProvided"),
          ...property.owners.map((o) => o.fullName[locale]),
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <p lang={locale === "ar" ? "en" : "ar"}>
        {property.name[locale === "ar" ? "en" : "ar"]}
      </p>
      <span className="inline-flex rounded-sm border bg-status-neutral-bg ps-2 pe-2 text-caption-strong text-status-neutral-fg">
        {t("jurisdiction")}
      </span>
      <div aria-live="polite">{saved && t("saved")}</div>
      {manager && (
        <div className="flex flex-wrap gap-3">
          <a
            href={`${base}/properties/${property.id}/units/new`}
            className={buttonVariants({
              variant: selected ? "secondary" : "default",
            })}
          >
            {t("addUnits")}
          </a>
          <a
            href={`${base}/properties/${property.id}/edit`}
            className={buttonVariants({ variant: "secondary" })}
          >
            {t("edit")}
          </a>
          <Button
            variant="secondary"
            onClick={() => {
              setSelected("title_deed");
            }}
          >
            {t("uploadDocument")}
          </Button>
        </div>
      )}
      <p>
        {t("approvalLine", {
          value: t(property.ownerGate.value ? "on" : "off"),
          source: t(`sources.${property.ownerGate.source}`),
        })}
      </p>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <TitleDeed
            property={property}
            companyId={companyId}
            manager={manager}
            onOpen={() => {
              setSelected("title_deed");
            }}
          />
          <ComplianceDocuments
            property={property}
            companyId={companyId}
            manager={manager}
            onOpen={setSelected}
          />
        </div>
        <UnitsTable
          units={property.units}
          companyId={companyId}
          propertyId={property.id}
          manager={manager}
        />
      </div>
      {manager && (
        <EstateHistory entries={property.history} namespace="Properties" />
      )}
      {manager && selected && (
        <UploadPanel
          key={selected}
          companyId={companyId}
          recordId={property.id}
          entity="properties"
          docType={selected}
          document={property.documents.find((d) => d.docType === selected)}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
function TitleDeed({
  property,
  companyId,
  manager,
  onOpen,
}: {
  property: PropertyDetail;
  onOpen: () => void;
  companyId: string;
  manager: boolean;
}): ReactElement {
  const t = useTranslations("Properties");
  const document = property.documents.find((d) => d.docType === "title_deed");
  const version = document?.latest;
  return (
    <section className="space-y-4 rounded-md border p-6">
      <h2 className="text-h2">{t("titleDeed")}</h2>
      {version ? (
        <div className="space-y-2">
          <StatusTag entity="document_version" state={version.reviewStatus} />
          <DocumentProcessing version={version} namespace="Properties" />
        </div>
      ) : (
        <p>{t("missing")}</p>
      )}
      <dl className="grid grid-cols-2 gap-3">
        {(
          [
            "plotNo",
            "prpNumber",
            "onwaniAddress",
            "zone",
            "titleDeedNo",
          ] as const
        ).map((key) => (
          <div key={key} className="contents">
            <dt>{t(key)}</dt>
            <dd>
              {property[key] ? (
                <IdentifierText kind="prp" value={property[key]} />
              ) : (
                t("notProvided")
              )}
            </dd>
          </div>
        ))}
        <dt>{t("use")}</dt>
        <dd>{property.use ? t(`uses.${property.use}`) : t("notProvided")}</dd>
      </dl>
      {manager && (
        <DocumentAction
          companyId={companyId}
          recordId={property.id}
          entity="properties"
          docType="title_deed"
          document={document}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}
function ComplianceDocuments({
  property,
  companyId,
  manager,
  onOpen,
}: {
  property: PropertyDetail;
  onOpen: (type: UploadInput["docType"]) => void;
  companyId: string;
  manager: boolean;
}): ReactElement {
  const t = useTranslations("Properties");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  return (
    <section className="space-y-4 rounded-md border p-6">
      <h2 className="text-h2">{t("compliance")}</h2>
      <ul className="divide-y">
        {propertyDocTypeSchema.options
          .filter((type) => type !== "title_deed")
          .map((type) => {
            const doc = property.documents.find((d) => d.docType === type);
            const version = doc?.latest ?? doc?.current;
            return (
              <li key={type} className="space-y-2 py-3">
                <p>{t(`documents.${type}`)}</p>
                {version ? (
                  <div className="flex flex-wrap gap-2">
                    <DocumentProcessing
                      version={version}
                      namespace="Properties"
                    />
                    <StatusTag
                      entity="document_version"
                      state={version.reviewStatus}
                    />
                    {version.validity && (
                      <span>{t(`validity.${version.validity}`)}</span>
                    )}
                    {version.expiryDate && (
                      <DateText iso={version.expiryDate} locale={locale} />
                    )}
                  </div>
                ) : (
                  <p className="text-caption">{t("notProvided")}</p>
                )}
                {manager && (
                  <DocumentAction
                    companyId={companyId}
                    recordId={property.id}
                    entity="properties"
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
    </section>
  );
}
