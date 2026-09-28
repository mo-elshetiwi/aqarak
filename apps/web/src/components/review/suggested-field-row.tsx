"use client";
import { useId, useRef, useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Eye, Pencil } from "lucide-react";
import { isLocale } from "@aqarak/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DateText,
  IdentifierText,
  MoneyAmount,
} from "@/components/system/formatted-values";
import { ConfidenceBadge } from "./confidence-badge";
import { AiLabel } from "./ai-label";
import { ReviewIconButton } from "./review-icon-button";
import type { ReviewAction } from "./review-state";
import type {
  ConfidenceCategory,
  ExtractionProvenance,
  FieldDecision,
  SuggestedFieldInput,
} from "./types";

export interface SuggestedFieldRowProps {
  field: SuggestedFieldInput;
  decision: FieldDecision;
  category: ConfidenceCategory;
  selected: boolean;
  descriptionId: string;
  documentTitle: string;
  page: number;
  provenance: ExtractionProvenance;
  dispatch: (action: ReviewAction) => void;
  onViewSource: () => void;
}
export function SuggestedFieldRow({
  field,
  decision,
  category,
  selected,
  descriptionId,
  documentTitle,
  page,
  provenance,
  dispatch,
  onViewSource,
}: SuggestedFieldRowProps): ReactElement {
  const t = useTranslations("Review");
  const id = useId();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const undecided = decision.status === "undecided";
  const blocked = field.requiresSourceCheck && !decision.sourceViewed;
  const finishEditing = (): void => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  return (
    <article
      data-testid={`field-${field.id}`}
      data-state={decision.status}
      aria-labelledby={`${id}-label`}
      aria-describedby={selected ? descriptionId : undefined}
      className={rowStyles(undecided, blocked, selected)}
    >
      <FieldHeading
        field={field}
        category={category}
        sourceViewed={decision.sourceViewed}
        labelId={`${id}-label`}
      />
      <span id={descriptionId} className="sr-only">
        {t("sourceDescription", { field: field.label, page })}
      </span>
      {editing ? (
        <FieldEditor
          field={field}
          initialValue={decision.value ?? ""}
          onCancel={finishEditing}
          onSave={(value) => {
            dispatch({ type: "edit", id: field.id, value });
            finishEditing();
          }}
        />
      ) : (
        <div className="min-h-6 text-body-strong">
          <FieldValue field={field} decision={decision} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {undecided ? (
          <AiLabel
            provenance={provenance}
            documentTitle={documentTitle}
            page={page}
            fieldClass={field.fieldClass}
          />
        ) : (
          <span className="inline-flex items-center gap-1 text-caption-strong text-status-success-fg">
            <Check aria-hidden="true" className="size-4" />
            {t(`decision.${decision.status}`)}
          </span>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-1">
          <ReviewIconButton
            label={t("viewSource", { field: field.label })}
            onClick={onViewSource}
          >
            <Eye aria-hidden="true" />
          </ReviewIconButton>
          {undecided && (
            <ReviewIconButton
              label={t("acceptField", { field: field.label })}
              disabled={blocked || editing}
              describedBy={blocked ? `${id}-reason` : undefined}
              onClick={() => {
                dispatch({ type: "accept", id: field.id });
                requestAnimationFrame(() => editButton.current?.focus());
              }}
            >
              <Check aria-hidden="true" />
            </ReviewIconButton>
          )}
          <Button
            ref={editButton}
            variant="ghost"
            size="icon"
            aria-label={t("editField", { field: field.label })}
            disabled={editing}
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            variant="link"
            size="sm"
            disabled={editing || decision.status === "not_on_document"}
            onClick={() => {
              dispatch({ type: "mark_not_on_document", id: field.id });
              requestAnimationFrame(() => editButton.current?.focus());
            }}
          >
            {t("notOnDocument")}
          </Button>
        </div>
      </div>
      {blocked && undecided && (
        <p
          id={`${id}-reason`}
          className="text-caption text-confidence-confirm-fg"
        >
          {t("openSourceFirst")}
        </p>
      )}
      {!undecided && (
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            dispatch({ type: "revert", id: field.id });
            setEditing(false);
          }}
        >
          {t("revert")}
        </Button>
      )}
    </article>
  );
}
function FieldValue({
  field,
  decision,
}: {
  field: SuggestedFieldInput;
  decision: FieldDecision;
}): ReactElement {
  const t = useTranslations("Review");
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : "en";
  if (decision.value === null)
    return <span className="text-foreground">{t("notOnDocument")}</span>;
  if (field.fieldClass === "identity_number")
    return <IdentifierText value={decision.value} kind="emirates_id" />;
  if (field.fieldClass === "unit_code" || field.fieldClass === "plot_code")
    return (
      <IdentifierText
        value={decision.value}
        kind={field.fieldClass === "unit_code" ? "unt" : "prp"}
      />
    );
  if (field.fieldClass === "date")
    return <DateText iso={decision.value} locale={locale} />;
  if (field.fieldClass === "money")
    return (
      <MoneyAmount
        fils={Math.round(Number(decision.value) * 100)}
        locale={locale}
      />
    );
  return <bdi>{decision.value}</bdi>;
}

function rowStyles(
  undecided: boolean,
  blocked: boolean,
  selected: boolean,
): string {
  return `space-y-3 rounded-md border p-4 ${undecided ? "border-ai-border bg-ai-bg" : "border-border bg-card"} ${blocked ? "border-2 border-confidence-confirm-border" : ""} ${selected ? "outline-2 outline-brand" : ""}`;
}
function FieldHeading({
  field,
  category,
  sourceViewed,
  labelId,
}: {
  field: SuggestedFieldInput;
  category: ConfidenceCategory;
  sourceViewed: boolean;
  labelId: string;
}): ReactElement {
  const t = useTranslations("Review");
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-1">
        <h3 id={labelId} className="text-caption-strong">
          {field.label}
        </h3>
        {field.flagReason && (
          <p className="text-caption text-confidence-confirm-fg">
            {t("flagged", { reason: field.flagReason })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge category={category} />
        {sourceViewed && (
          <span className="text-caption text-foreground">
            {t("sourceOpened")}
          </span>
        )}
      </div>
    </div>
  );
}
function FieldEditor({
  field,
  initialValue,
  onSave,
  onCancel,
}: {
  field: SuggestedFieldInput;
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}): ReactElement {
  const t = useTranslations("Review");
  const id = useId();
  const [draft, setDraft] = useState(initialValue);
  const identifier = ["identity_number", "unit_code", "plot_code"].includes(
    field.fieldClass,
  );
  const type =
    field.fieldClass === "date"
      ? "date"
      : field.fieldClass === "money"
        ? "number"
        : "text";
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) onSave(draft);
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t("editField", { field: field.label })}
      </label>
      <Input
        id={id}
        autoFocus
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        type={type}
        step={field.fieldClass === "money" ? "0.01" : undefined}
        dir={identifier || type !== "text" ? "ltr" : "auto"}
        className={identifier ? "font-mono" : undefined}
        required
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!draft.trim()}
        >
          {t("save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
