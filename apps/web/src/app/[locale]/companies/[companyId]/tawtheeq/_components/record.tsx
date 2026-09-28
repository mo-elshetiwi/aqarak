"use client";
import { useState, type ReactElement } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { PageHeader } from "@/components/system/page-header";
import { Button } from "@/components/ui/button";
import { useCsrfToken } from "@/components/shell/session-context";
import {
  tawtheeqAction,
  type ActionFailure,
  type ActionResult,
} from "../[recordId]/_actions";
import {
  fieldKeySchema,
  type DocumentUrl,
  type Extraction,
  type TawtheeqRecord,
} from "../_lib/schemas";
import { contractValues } from "../_lib/fixtures";
import { ActionsMenu } from "./actions-menu";
import { ActionError, Connectivity, Value, WorkflowStatus } from "./common";
import { ComparisonPanel } from "./comparison";
import { ExtractionReview } from "./review";
import { CertificateSource } from "./source";
import { UploadPanel } from "./upload";
import type { RunAction } from "./use-mutation";
export function RecordScreen({
  initialRecord,
  initialSource,
  companyId,
  locale,
  synthetic,
}: {
  initialRecord: TawtheeqRecord;
  initialSource: DocumentUrl | null;
  companyId: string;
  locale: Locale;
  synthetic: boolean;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const csrfToken = useCsrfToken();
  const [record, setRecord] = useState(initialRecord);
  const [source, setSource] = useState(initialSource);
  const [extraction, setExtraction] = useState<Extraction | null>(() =>
    initialRecord.extraction
      ? {
          ...initialRecord.extraction,
          status: "succeeded",
          degradedMode: null,
          comparisonPreview: [],
        }
      : null,
  );
  const [extractKey, setExtractKey] = useState(() => crypto.randomUUID());
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [replace, setReplace] = useState(false);
  async function loadSource(): Promise<void> {
    const result = await tawtheeqAction({
      companyId,
      recordId: record.id,
      csrfToken,
      idempotencyKey: crypto.randomUUID(),
      command: "getDocumentUrl",
      input: {},
    });
    if (result.ok && result.documentUrl) setSource(result.documentUrl);
  }
  async function extract(): Promise<void> {
    if (extracting) return;
    setExtracting(true);
    setError(null);
    const result = await tawtheeqAction({
      companyId,
      recordId: record.id,
      csrfToken,
      idempotencyKey: extractKey,
      command: "runExtraction",
      input: {},
    });
    if (result.ok) {
      setRecord(result.record);
      if (result.extraction) setExtraction(result.extraction);
      await loadSource();
    } else setError(result);
    setExtracting(false);
  }
  const run: RunAction = async (action, key): Promise<ActionResult> => {
    const result = await tawtheeqAction({
      companyId,
      recordId: record.id,
      csrfToken,
      idempotencyKey: key,
      ...action,
    });
    if (result.ok) {
      setRecord(result.record);
      if (action.command === "completeUpload") {
        setReplace(false);
        setSource(null);
        setExtraction(null);
        if (result.record.document?.processingStatus === "scan_clean")
          await extract();
      }
      if (action.command === "requestUpload")
        setExtractKey(crypto.randomUUID());
    }
    return result;
  };
  const showUpload =
    record.allowedActions.includes("upload") &&
    (record.workflowState !== "registered" || replace);
  return (
    <div className="space-y-6 text-base leading-relaxed">
      <Link
        className="inline-flex min-h-6 items-center text-brand underline"
        href={`/${locale}/companies/${companyId}/tawtheeq`}
      >
        {t("back")}
      </Link>
      <div dir="auto">
        <PageHeader
          title={t("recordTitle", { contract: record.contract.contractNo })}
        />
      </div>
      <RecordDetails record={record} />
      <nav
        className="flex gap-6 border-b pb-3"
        aria-label={t("recordTitle", { contract: record.contract.contractNo })}
      >
        <span aria-current="page">{t("overview")}</span>
        <Link
          className="text-brand underline"
          href={`/${locale}/companies/${companyId}/tawtheeq/${record.id}?tab=history`}
        >
          {t("history")}
        </Link>
      </nav>
      <Connectivity />
      {synthetic && (
        <p className="rounded-md border bg-muted p-4">{t("syntheticNote")}</p>
      )}
      <ActionsMenu
        key={`${record.workflowState}-${String(record.version)}`}
        record={record}
        run={run}
        replace={() => {
          setReplace(true);
        }}
      />
      {record.skipReason && (
        <div className="space-y-2 rounded-md border p-4">
          {record.workflowState === "awaiting_registration" && (
            <p>{t("skipPending")}</p>
          )}
          <p>
            {t("reasonSaved")}: <bdi dir="auto">{record.skipReason}</bdi>
          </p>
        </div>
      )}
      {record.returnReason && (
        <p>
          {t("reasonSaved")}: <bdi dir="auto">{record.returnReason}</bdi>
        </p>
      )}
      {record.document?.reviewStatus === "rejected" && (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <CertificateSource
            source={source}
            synthetic={synthetic}
            retry={() => {
              void loadSource();
            }}
          />
          <IdentityRejection record={record} locale={locale} />
        </div>
      )}
      {showUpload && (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <PortalSummary record={record} locale={locale} />
          <UploadPanel record={record} run={run} />
        </div>
      )}
      {record.workflowState === "under_review" && (
        <ReviewStage
          record={record}
          extraction={extraction}
          source={source}
          extracting={extracting}
          synthetic={synthetic}
          error={error}
          run={run}
          loadSource={() => {
            void loadSource();
          }}
          extract={() => {
            void extract();
          }}
        />
      )}
      {record.workflowState === "discrepancies_open" && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(16rem,0.6fr)_minmax(0,1.4fr)]">
          <CertificateSource
            source={source}
            synthetic={synthetic}
            retry={() => {
              void loadSource();
            }}
          />
          <ComparisonPanel record={record} locale={locale} run={run} />
        </div>
      )}
      {record.adoption && <AdoptionSummary record={record} locale={locale} />}
      {record.workflowState === "registered" && !showUpload && (
        <p
          role="status"
          className="rounded-md border border-status-success-border bg-status-success-bg p-4 text-status-success-fg"
        >
          {t("registeredSuccess")}
        </p>
      )}
    </div>
  );
}
function PortalSummary({
  record,
  locale,
}: {
  record: TawtheeqRecord;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  return (
    <section className="space-y-4">
      <h2 className="text-h2">{t("portalSummary")}</h2>
      <p>{t("portalHelp")}</p>
      <dl className="divide-y rounded-lg border">
        {Object.entries(contractValues(record)).map(([field, value]) => {
          const parsed = fieldKeySchema.safeParse(field);
          if (!parsed.success) return null;
          return (
            <div key={field} className="grid grid-cols-2 gap-4 p-4">
              <dt>{t(`fields.${parsed.data}`)}</dt>
              <dd>
                <Value field={parsed.data} value={value} locale={locale} />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
function IdentityRejection({
  record,
  locale,
}: {
  record: TawtheeqRecord;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  return (
    <section className="space-y-4 rounded-lg border border-status-danger-border bg-status-danger-bg p-6 text-status-danger-fg">
      <h2 className="text-h2">{t("identityTitle")}</h2>
      <p>{t("identityHelp")}</p>
      <p>
        {t("rejectedFile")}: <bdi>{record.document?.documentVersionId}</bdi>
      </p>
      {record.comparison
        .filter((r) => r.class === "identity" && r.status !== "match")
        .map((r) => (
          <div key={r.field} className="space-y-2">
            <h3 className="font-semibold">{t(`fields.${r.field}`)}</h3>
            <p>
              {t("contract")}:{" "}
              <Value field={r.field} value={r.contractValue} locale={locale} />
            </p>
            <p>
              {t("registered")}:{" "}
              <Value
                field={r.field}
                value={r.registeredValue}
                locale={locale}
              />
            </p>
          </div>
        ))}
    </section>
  );
}
function AdoptionSummary({
  record,
  locale,
}: {
  record: TawtheeqRecord;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const adoption = record.adoption;
  if (!adoption) return <></>;
  return (
    <section
      aria-labelledby="adoption-title"
      className="space-y-4 rounded-lg border bg-card p-6"
    >
      <h2 id="adoption-title" className="text-h2">
        {t("adoptionTitle")}
      </h2>
      <p>{t("adoptionVersion", { version: adoption.versionNo })}</p>
      <p>{t("currentVersion", { version: record.contract.versionNo })}</p>
      <Link
        className="text-brand underline"
        href={`?tab=history&subjectType=contract_version&subjectId=${adoption.contractVersionId}`}
      >
        {t("contractHistory")}
      </Link>
      <p>
        {t(
          record.workflowState === "awaiting_owner_reapproval"
            ? "ownerConsequence"
            : "currentConsequence",
        )}
      </p>
      <dl className="space-y-3">
        {Object.entries(adoption.changedFields).map(([field, value]) => {
          const parsed = fieldKeySchema.safeParse(field);
          return parsed.success ? (
            <div key={field} className="flex flex-wrap gap-4">
              <dt>{t(`fields.${parsed.data}`)}</dt>
              <dd>
                <Value field={parsed.data} value={value} locale={locale} />
              </dd>
            </div>
          ) : null;
        })}
      </dl>
    </section>
  );
}
function ScanPending({
  record,
  run,
}: {
  record: TawtheeqRecord;
  run: RunAction;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function check(): Promise<void> {
    if (!record.document) return;
    setBusy(true);
    const result = await run(
      {
        command: "completeUpload",
        input: {
          expectedVersion: record.version,
          documentVersionId: record.document.documentVersionId,
        },
      },
      key,
    );
    if (!result.ok) setError(result);
    setBusy(false);
  }
  return (
    <div className="space-y-4 rounded-md border p-6">
      <p role="status">{t("scanPending")}</p>
      <ActionError error={error} />
      <Button
        disabled={busy}
        onClick={() => {
          void check();
        }}
      >
        {t("checkScan")}
      </Button>
    </div>
  );
}

function RecordDetails({ record }: { record: TawtheeqRecord }): ReactElement {
  const t = useTranslations("Tawtheeq");
  const portalKey = `portals.${record.portalStatus}`;
  const nextActor =
    record.workflowState === "awaiting_owner_reapproval" ||
    (record.skipReason && record.workflowState === "awaiting_registration")
      ? "owner"
      : ["registered", "skipped", "closed"].includes(record.workflowState)
        ? "complete"
        : "manager";
  return (
    <div className="flex flex-wrap items-center gap-4">
      <WorkflowStatus state={record.workflowState} />
      <Link
        className="text-brand underline"
        href={`?tab=history&subjectType=contract_version&subjectId=${record.contract.currentVersionId}`}
      >
        {t("contractHistory")}
      </Link>
      <p>
        {t("portal")}: {t.has(portalKey) ? t(portalKey) : t("unknown")}
      </p>
      <p>
        {t("pending")}:{" "}
        {record.daysPending === null
          ? t("none")
          : t("days", { count: record.daysPending })}
      </p>
      <p>
        {t("nextActor")}: {t(nextActor)}
      </p>
    </div>
  );
}
function ReviewStage({
  record,
  extraction,
  source,
  extracting,
  synthetic,
  error,
  run,
  loadSource,
  extract,
}: {
  record: TawtheeqRecord;
  extraction: Extraction | null;
  source: DocumentUrl | null;
  extracting: boolean;
  synthetic: boolean;
  error: ActionFailure | null;
  run: RunAction;
  loadSource: () => void;
  extract: () => void;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  if (record.document?.processingStatus === "uploaded")
    return <ScanPending key={record.version} record={record} run={run} />;
  if (record.document?.processingStatus === "scan_rejected")
    return <p role="alert">{t("scanRejected")}</p>;
  return (
    <>
      <p role="status" aria-live="polite">
        {extracting ? t("extracting") : ""}
      </p>
      <ActionError error={error} />
      {extraction ? (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <CertificateSource
            source={source}
            synthetic={synthetic}
            retry={loadSource}
          />
          <ExtractionReview
            key={extraction.extractionId ?? record.document?.documentVersionId}
            record={record}
            extraction={extraction}
            sourceAvailable={Boolean(source)}
            run={run}
          />
        </div>
      ) : (
        <Button disabled={extracting} onClick={extract}>
          {t("extract")}
        </Button>
      )}
    </>
  );
}
