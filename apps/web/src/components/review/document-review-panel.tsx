"use client";
import { useId, useReducer, useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SourceViewer, type SourceSelection } from "./source-viewer";
import { SuggestedFieldRow } from "./suggested-field-row";
import {
  canContinue,
  categoryOf,
  createReviewState,
  provenanceOf,
  reviewReducer,
} from "./review-state";
import type {
  CommittedDecisions,
  ExtractionProvenance,
  FieldClass,
  ReviewDocument,
  SuggestedFieldInput,
} from "./types";

export interface DocumentReviewPanelProps {
  document: ReviewDocument;
  fields: SuggestedFieldInput[];
  calibratedClasses: FieldClass[];
  provenance: ExtractionProvenance;
  onContinue: (decisions: CommittedDecisions) => void;
  qualityNote?: string;
}
export function DocumentReviewPanel({
  document,
  fields,
  calibratedClasses,
  provenance,
  onContinue,
  qualityNote,
}: DocumentReviewPanelProps): ReactElement {
  const t = useTranslations("Review");
  const id = useId();
  const [state, dispatch] = useReducer(
    reviewReducer,
    { fields, calibratedClasses },
    (initial) => createReviewState(initial.fields, initial.calibratedClasses),
  );
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  const decided = Object.values(state.decisions).filter(
    (decision) => decision.status === "accepted",
  ).length;
  const openConfirm = state.fields.filter(
    (field) =>
      categoryOf(state, field) === "confirm" &&
      state.decisions[field.id]?.status === "undecided",
  ).length;
  const absent = Object.values(state.decisions).filter(
    (decision) => decision.value === null,
  ).length;
  const remaining = state.fields.some(
    (field) =>
      categoryOf(state, field) === "suggested" &&
      state.decisions[field.id]?.status === "undecided" &&
      (!field.requiresSourceCheck || state.decisions[field.id]?.sourceViewed),
  );
  function continueReview(): void {
    if (!canContinue(state)) return;
    const decisions: CommittedDecisions = {};
    for (const [fieldId, decision] of Object.entries(state.decisions)) {
      const provenanceValue = provenanceOf(decision);
      if (provenanceValue)
        decisions[fieldId] = { ...decision, provenance: provenanceValue };
    }
    onContinue(decisions);
  }
  function viewSource(field: SuggestedFieldInput, descriptionId: string): void {
    const page = field.region?.page ?? document.pages[0]?.number;
    if (
      page === undefined ||
      !document.pages.some((entry) => entry.number === page)
    )
      return;
    dispatch({ type: "view_source", id: field.id });
    setSelection((previous) => ({
      fieldId: field.id,
      label: field.label,
      region: field.region,
      page,
      descriptionId,
      request: (previous?.request ?? 0) + 1,
    }));
  }
  return (
    <TooltipProvider>
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
        <SourceViewer
          document={document}
          selection={selection}
          qualityNote={qualityNote}
        />
        <section
          data-testid="fields-pane"
          aria-labelledby={`${id}-heading`}
          className="min-w-0 space-y-4 overflow-auto p-1 md:max-h-[76vh]"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 id={`${id}-heading`} className="text-h2">
              {t("identityHeading")}
            </h2>
            <p
              aria-live="polite"
              className="text-caption text-muted-foreground"
            >
              {t("acceptedCount", { count: decided, total: fields.length })}
            </p>
          </div>
          {state.fields.map((field, index) => {
            const decision = state.decisions[field.id];
            if (!decision) return null;
            const descriptionId = `${id}-source-${String(index)}`;
            return (
              <SuggestedFieldRow
                key={field.id}
                field={field}
                decision={decision}
                category={categoryOf(state, field)}
                selected={selection?.fieldId === field.id}
                descriptionId={descriptionId}
                documentTitle={document.title}
                page={field.region?.page ?? document.pages[0]?.number ?? 1}
                provenance={provenance}
                dispatch={dispatch}
                onViewSource={() => {
                  viewSource(field, descriptionId);
                }}
              />
            );
          })}
          <footer className="space-y-4 rounded-md border bg-card p-4">
            <p className="text-caption text-muted-foreground">
              <Sparkles
                aria-hidden="true"
                className="me-1 inline size-4 text-ai-fg"
              />
              {t("modelLine", {
                registry: provenance.registryEntry,
                version: provenance.version,
                page: selection?.page ?? document.pages[0]?.number ?? 1,
                count: absent,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={!remaining}
                onClick={() => {
                  dispatch({ type: "accept_remaining_suggested" });
                }}
              >
                {t("acceptRemaining")}
              </Button>
              <Button
                disabled={!canContinue(state)}
                aria-describedby={`${id}-continue-reason`}
                onClick={continueReview}
              >
                {t("continue")}
                <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
              </Button>
            </div>
            <p
              id={`${id}-continue-reason`}
              className="text-caption text-muted-foreground"
            >
              <LockKeyhole aria-hidden="true" className="me-1 inline size-4" />
              {t("confirmReason", { count: openConfirm })}
            </p>
          </footer>
        </section>
      </div>
    </TooltipProvider>
  );
}
export { SourceViewer } from "./source-viewer";
export { SuggestedFieldRow } from "./suggested-field-row";
export { ConfidenceBadge } from "./confidence-badge";
export { AiLabel } from "./ai-label";
