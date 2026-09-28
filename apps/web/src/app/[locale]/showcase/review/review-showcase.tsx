"use client";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { LanguageSwitch } from "@/components/system/language-switch";
import { ThemeSwitch } from "@/components/system/theme-switch";
import { StatusTag } from "@/components/system/status-tag";
import { Button } from "@/components/ui/button";
import {
  AiLabel,
  DocumentReviewPanel,
} from "@/components/review/document-review-panel";
import type {
  CommittedDecisions,
  SuggestedFieldInput,
} from "@/components/review/types";
const provenance = {
  registryEntry: "document-extraction",
  version: "2026-09-28.1",
  ranAt: "2026-09-28T06:00:00+04:00",
};
export function ReviewShowcase(): ReactElement {
  const t = useTranslations("Review");
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<CommittedDecisions | null>(null);
  const fields: SuggestedFieldInput[] = [
    {
      id: "englishName",
      label: t("fields.englishName"),
      fieldClass: "text",
      value: "Khalid Al Suwaidi",
      modelCategory: "check",
      region: { page: 1, x: 0.27, y: 0.24, width: 0.64, height: 0.08 },
      requiresSourceCheck: false,
    },
    {
      id: "arabicName",
      label: t("fields.arabicName"),
      fieldClass: "text",
      value: "خالد السويدي",
      modelCategory: "check",
      region: { page: 1, x: 0.27, y: 0.34, width: 0.64, height: 0.08 },
      requiresSourceCheck: false,
    },
    {
      id: "identityNumber",
      label: t("fields.identityNumber"),
      fieldClass: "identity_number",
      value: "784-1978-4829163-5",
      modelCategory: "suggested",
      region: { page: 1, x: 0.27, y: 0.44, width: 0.64, height: 0.08 },
      requiresSourceCheck: true,
      flagReason: t("flagReason"),
    },
    {
      id: "nationality",
      label: t("fields.nationality"),
      fieldClass: "nationality",
      value: t("values.nationality"),
      modelCategory: "check",
      region: { page: 1, x: 0.27, y: 0.59, width: 0.67, height: 0.06 },
      requiresSourceCheck: false,
    },
    {
      id: "birthDate",
      label: t("fields.birthDate"),
      fieldClass: "date",
      value: "1978-03-12",
      modelCategory: "confirm",
      region: { page: 1, x: 0.27, y: 0.7, width: 0.27, height: 0.07 },
      requiresSourceCheck: false,
    },
    {
      id: "expiryDate",
      label: t("fields.expiryDate"),
      fieldClass: "date",
      value: "2029-03-11",
      modelCategory: "confirm",
      region: { page: 1, x: 0.65, y: 0.7, width: 0.28, height: 0.07 },
      requiresSourceCheck: false,
    },
    {
      id: "cardNumber",
      label: t("fields.cardNumber"),
      fieldClass: "text",
      value: null,
      modelCategory: "check",
      region: null,
      requiresSourceCheck: false,
    },
    {
      id: "occupation",
      label: t("fields.occupation"),
      fieldClass: "text",
      value: t("values.occupation"),
      modelCategory: "suggested",
      region: { page: 1, x: 0.27, y: 0.82, width: 0.64, height: 0.06 },
      requiresSourceCheck: false,
    },
  ];
  return (
    <main className="ms-auto me-auto max-w-[96rem] space-y-6 ps-4 pe-4 py-8 md:ps-8 md:pe-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h1">{t("title")}</h1>
        <LanguageSwitch href="/showcase/review" />
      </div>
      <ThemeSwitch />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-h2">{t("reviewTitle")}</h2>
            <AiLabel
              provenance={provenance}
              documentTitle={t("documentTitle")}
              page={1}
              fieldClass="identity_number"
            />
            <StatusTag entity="document_version" state="pending_review" />
          </div>
          <p className="text-body-dense text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setRevision((value) => value + 1);
            setSummary(null);
          }}
        >
          {t("discard")}
        </Button>
      </header>
      <p className="text-caption text-muted-foreground">
        {t("syntheticNotice")}
      </p>
      <DocumentReviewPanel
        key={revision}
        document={{
          title: t("documentTitle"),
          synthetic: true,
          pages: [
            {
              number: 1,
              imageSrc: "/showcase/synthetic-emirates-id-front.svg",
              alt: t("imageAlt"),
            },
          ],
        }}
        fields={fields}
        calibratedClasses={["text"]}
        provenance={provenance}
        qualityNote={t("quality")}
        onContinue={setSummary}
      />
      <div role="status" aria-live="polite" aria-atomic="true">
        {summary && (
          <section className="space-y-3 rounded-lg border bg-card p-6">
            <h2 className="text-h2">{t("summaryTitle")}</h2>
            <p className="text-body-dense text-muted-foreground">
              {t("summaryNote")}
            </p>
            <ul className="space-y-2">
              {fields.map((field) => (
                <li key={field.id}>
                  {field.label}:{" "}
                  <bdi>
                    {summary[field.id]?.value ??
                      (summary[field.id] ? t("notOnDocument") : "")}
                  </bdi>{" "}
                  ·{" "}
                  {t(
                    `provenance.${summary[field.id]?.provenance ?? "undecided"}`,
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
