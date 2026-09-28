"use client";
import { useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DocumentReviewPanel } from "@/components/review/document-review-panel";
import type {
  CommittedDecisions,
  SuggestedFieldInput,
} from "@/components/review/types";
import { ErrorSummary, FieldError } from "@/components/system/screen-states";
import { RejectUploadDialog } from "./reject-upload-dialog";
import { recordDecisionsAction } from "../_lib/actions";
import {
  fieldCatalogue,
  type VersionDetail,
  type Problem,
  type FieldName,
} from "../_lib/j3-contract";
import { reviewPath, type ReviewRoute } from "../_lib/routes";
export function ReviewForm({
  route,
  version,
  imageUrl,
  synthetic,
  changeField,
}: {
  route: ReviewRoute;
  version: VersionDetail;
  imageUrl: string;
  synthetic: boolean;
  changeField?: FieldName;
}): ReactElement {
  const t = useTranslations("Documents");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const [inlineTarget, setInlineTarget] = useState<HTMLElement | null>(null);
  const command = useRef<{ key: string; fingerprint: string } | null>(null);
  const busy = useRef(false);
  const manual = version.processingStatus === "extraction_failed";
  const fields: SuggestedFieldInput[] = fieldCatalogue
    .filter((field) => !changeField || field.name === changeField)
    .map((field) => {
      const extracted = version.fields?.find(
        (item) => item.name === field.name,
      );
      const recorded = changeField
        ? version.decisions.find((item) => item.fieldName === field.name)
        : undefined;
      return {
        id: field.name,
        label: t(`fields.${field.name}`),
        fieldClass: field.fieldClass,
        value: recorded
          ? recorded.value
          : manual
            ? null
            : (extracted?.suggestedValue ?? null),
        modelCategory: extracted?.category ?? "check",
        region: null,
        requiresSourceCheck: extracted?.requiresSourceCheck ?? false,
        ...(extracted?.requiresSourceCheck
          ? { flagReason: t("flagReason") }
          : {}),
      };
    });
  async function continueReview(decisions: CommittedDecisions): Promise<void> {
    if (busy.current) return;
    const recorded = Object.fromEntries(
      version.decisions.map((item) => [
        item.fieldName,
        {
          status: item.decision,
          value: item.value,
          sourceViewed: item.sourceViewed,
          provenance: item.provenance,
        },
      ]),
    );
    const merged = { ...recorded, ...normalizeDecisions(decisions, version) };
    const fingerprint = JSON.stringify(merged);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { key: crypto.randomUUID(), fingerprint };
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await recordDecisionsAction({
        ...route,
        key: command.current.key,
        decisions: merged,
      });
      if (result.ok) {
        router.push(`${reviewPath(route)}/check`);
        return;
      }
      setError(result);
      if (result.field) {
        const row = document.querySelector<HTMLElement>(
          `[data-testid="field-${fieldCatalogue.find((item) => item.name === result.field)?.name ?? ""}"]`,
        );
        if (row) {
          row.id = `review-${result.field}`;
          row.tabIndex = -1;
          row.setAttribute("aria-describedby", "decision-field-error");
        }
        setInlineTarget(row);
      }
    } catch {
      setError({ code: "UNAVAILABLE" });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const errorMessage = reviewErrorMessage(error, t);
  const provenance = reviewProvenance(version, t);
  return (
    <div className="space-y-4">
      {version.reviewStatus === "pending_review" && (
        <RejectUploadDialog route={route} disabled={pending} />
      )}
      {manual && (
        <p role="status" className="rounded-md border bg-muted p-4">
          {t("manual")}
        </p>
      )}
      {error && (
        <ErrorSummary
          errors={[
            {
              fieldId: error.field ? `review-${error.field}` : "review-panel",
              message: errorMessage,
            },
          ]}
        />
      )}
      {error &&
        inlineTarget &&
        createPortal(
          <FieldError id="decision-field-error" message={errorMessage} />,
          inlineTarget,
        )}
      {error && !inlineTarget && (
        <FieldError id="decision-error" message={errorMessage} />
      )}
      {pending && <p role="status">{t("pending")}</p>}
      <fieldset
        id="review-panel"
        tabIndex={-1}
        disabled={pending}
        aria-busy={pending}
        className="min-w-0 border-0 p-0"
      >
        <DocumentReviewPanel
          document={{
            title: version.fileName,
            pages: [{ number: 1, imageSrc: imageUrl, alt: t("imageAlt") }],
            synthetic,
          }}
          fields={fields}
          calibratedClasses={[]}
          provenance={provenance}
          onContinue={(decisions) => {
            void continueReview(decisions);
          }}
        />
      </fieldset>
    </div>
  );
}

function reviewErrorMessage(
  error: Problem | null,
  t: ReturnType<typeof useTranslations<"Documents">>,
): string {
  if (!error) return "";
  const field = fieldCatalogue.find((item) => item.name === error.field);
  return `${field ? `${t(`fields.${field.name}`)}: ` : ""}${t(`errors.${error.code}`)}`;
}
function reviewProvenance(
  version: VersionDetail,
  t: ReturnType<typeof useTranslations<"Documents">>,
): { registryEntry: string; version: string; ranAt: string } {
  return {
    registryEntry: version.modelCall?.registryEntry ?? t("manualModel"),
    version: version.modelCall?.promptVersion ?? t("manualVersion"),
    ranAt: version.modelCall?.createdAt ?? version.uploadedAt ?? "",
  };
}

function normalizeDecisions(
  decisions: CommittedDecisions,
  version: VersionDetail,
): CommittedDecisions {
  return Object.fromEntries(
    Object.entries(decisions).map(([name, decision]) => {
      const suggestion =
        version.fields?.find((field) => field.name === name)?.suggestedValue ??
        null;
      return [
        name,
        decision.status === "accepted" && decision.value !== suggestion
          ? { ...decision, status: "edited", provenance: "ai_edited" }
          : decision,
      ];
    }),
  );
}
