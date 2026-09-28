"use client";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  criticalFields,
  fieldKeys,
  reviewInputSchema,
  type Extraction,
  type FieldKey,
  type TawtheeqRecord,
} from "../_lib/schemas";
import { ActionError, controlClass } from "./common";
import { useMutation, type RunAction } from "./use-mutation";
function initialValues(extraction: Extraction): Record<string, string> {
  return Object.fromEntries(
    fieldKeys.map((key) => [
      key,
      extraction.status === "degraded"
        ? ""
        : (extraction.fields[key]?.value ?? ""),
    ]),
  );
}
export function ExtractionReview({
  record,
  extraction,
  sourceAvailable,
  run,
}: {
  record: TawtheeqRecord;
  extraction: Extraction;
  sourceAvailable: boolean;
  run: RunAction;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const [values, setValues] = useState(() => initialValues(extraction));
  const [confirmed, setConfirmed] = useState<
    Partial<Record<FieldKey, boolean>>
  >({});
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { busy, error, setError, submit } = useMutation(run);
  const ready =
    sourceAvailable &&
    criticalFields.every((field) => confirmed[field] && values[field]?.trim());
  function change(field: FieldKey, value: string): void {
    setValues((prior) => ({ ...prior, [field]: value }));
    setConfirmed((prior) => ({ ...prior, [field]: Boolean(value.trim()) }));
    setKey(crypto.randomUUID());
  }
  async function save(): Promise<void> {
    const fields = Object.fromEntries(
      fieldKeys
        .filter(
          (field) => criticalFields.includes(field) || values[field]?.trim(),
        )
        .map((field) => {
          const value = values[field] ?? "";
          const original =
            extraction.status === "degraded"
              ? null
              : extraction.fields[field]?.value;
          const provenance =
            original == null
              ? "manual"
              : (
                    field.endsWith("_fils")
                      ? original.trim().replace(/^0+(?=\d)/, "") ===
                        value.trim().replace(/^0+(?=\d)/, "")
                      : original === value
                  )
                ? "extracted"
                : "edited";
          return [field, { value, provenance }];
        }),
    );
    const parsed = reviewInputSchema.safeParse({
      expectedVersion: record.version,
      documentVersionId: record.document?.documentVersionId,
      extractionId: extraction.extractionId,
      fields,
    });
    if (!parsed.success) {
      setError({
        ok: false,
        code: "VALIDATION_FAILED",
        fieldErrors: Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join("."),
            ["INVALID_INPUT"],
          ]),
        ),
      });
      return;
    }
    await submit({ command: "submitReview", input: parsed.data }, key);
  }
  return (
    <section className="space-y-4" aria-labelledby="review-title">
      <h2 id="review-title" className="text-h2">
        {t("reviewTitle")}
      </h2>
      <p>{t("reviewHelp")}</p>
      {extraction.status === "degraded" && (
        <p
          role="status"
          className="rounded-md border border-status-attention-border bg-status-attention-bg p-4 text-status-attention-fg"
        >
          {t("manualReason", {
            reason:
              extraction.degradedMode === "manual_entry"
                ? t("manual_entry")
                : (extraction.degradedMode ?? t("manual_entry")),
          })}
        </p>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void save();
        }}
      >
        {fieldKeys.map((field) => {
          const critical = criticalFields.includes(field);
          const proposal = extraction.fields[field];
          const label = t(`fields.${field}`);
          return (
            <div
              key={field}
              className="space-y-3 rounded-lg border bg-card p-4"
              data-testid={`review-${field}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label htmlFor={`review-${field}`} className="font-semibold">
                  {label}
                </label>
                <span className="rounded-md border bg-muted ps-2 pe-2 py-1">
                  {t("notCalibrated")}
                </span>
              </div>
              <input
                id={`review-${field}`}
                className={controlClass}
                dir="auto"
                type={
                  field === "registered_on" || field.startsWith("term_")
                    ? "date"
                    : "text"
                }
                inputMode={field.endsWith("_fils") ? "decimal" : undefined}
                required={critical}
                value={values[field] ?? ""}
                disabled={busy}
                aria-describedby={`evidence-${field}`}
                onChange={(e) => {
                  change(field, e.target.value);
                }}
              />
              <p id={`evidence-${field}`} className="text-muted-foreground">
                {t("evidence")}:{" "}
                <bdi dir="auto">
                  {proposal?.evidence ??
                    proposal?.nullReason ??
                    t("noEvidence")}
                </bdi>
              </p>
              {critical && (
                <div className="space-y-2">
                  <p>{t("critical")}</p>
                  <label className="flex min-h-6 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-6 accent-primary"
                      checked={Boolean(confirmed[field])}
                      disabled={
                        busy || !sourceAvailable || !values[field]?.trim()
                      }
                      onChange={(e) => {
                        setConfirmed((prior) => ({
                          ...prior,
                          [field]: e.target.checked,
                        }));
                      }}
                    />
                    {t("confirm", { field: label })}
                  </label>
                </div>
              )}
            </div>
          );
        })}
        <ActionError error={error} />
        <Button type="submit" disabled={!ready || busy}>
          {t("reviewSubmit")}
        </Button>
      </form>
    </section>
  );
}
