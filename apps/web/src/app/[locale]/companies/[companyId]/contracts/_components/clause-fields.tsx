"use client";
import { useState, useTransition, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/system/screen-states";
import { suggestClause } from "../_lib/suggestion-action";
import { randomCommandKey } from "../_lib/view-helpers";
import {
  type DraftInput,
  type ClauseSuggestion,
  type ProblemCode,
} from "../_lib/schemas";
import { SuggestionBox } from "./suggestion-box";
export interface SuggestionContext {
  locale: Locale;
  companyId: string;
  contractId: string;
  csrfToken: string;
}
type Clause = DraftInput["specialClauses"][number];
export function ClauseFields({
  clauses,
  setClauses,
  pending,
  errors,
  suggestionContext,
}: {
  clauses: Clause[];
  setClauses: (value: Clause[]) => void;
  pending: boolean;
  errors: Record<string, string>;
  suggestionContext?: SuggestionContext;
}): ReactElement {
  const t = useTranslations("Contracts");
  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <h2 className="text-h2">{t("specialClauses")}</h2>
      {clauses.map((clause, index) => (
        <ClauseEditor
          key={index}
          clause={clause}
          index={index}
          pending={pending}
          errors={errors}
          suggestionContext={suggestionContext}
          onChange={(value) => {
            setClauses(clauses.map((item, i) => (i === index ? value : item)));
          }}
        />
      ))}
    </section>
  );
}
function ClauseEditor({
  clause,
  index,
  pending,
  errors,
  suggestionContext,
  onChange,
}: {
  clause: Clause;
  index: number;
  pending: boolean;
  errors: Record<string, string>;
  suggestionContext: SuggestionContext | undefined;
  onChange: (value: Clause) => void;
}): ReactElement {
  const t = useTranslations("Contracts");
  const [suggesting, startTransition] = useTransition();
  const [suggestion, setSuggestion] = useState<{
    value: ClauseSuggestion;
    source: string;
  } | null>(null);
  const [failure, setFailure] = useState<ProblemCode | null>(null);
  function request(): void {
    if (!suggestionContext || suggesting || pending || !clause.textEn.trim())
      return;
    const source = clause.textEn;
    const envelope = {
      ...suggestionContext,
      input: { textEn: source },
      idempotencyKey: randomCommandKey(),
    };
    setFailure(null);
    setSuggestion(null);
    startTransition(async () => {
      try {
        const result = await suggestClause(envelope);
        if (result.ok) setSuggestion({ value: result.value, source });
        else setFailure(result.code);
      } catch {
        setFailure("MODEL_UNAVAILABLE");
      }
    });
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(["textEn", "textAr"] as const).map((field) => {
        const id = `specialClauses-${String(index)}-${field}`;
        return (
          <div key={field} className="space-y-2">
            <Label htmlFor={id}>
              {t(field === "textEn" ? "specialEn" : "specialAr")}
            </Label>
            <Textarea
              id={id}
              lang={field === "textAr" ? "ar" : "en"}
              dir={field === "textAr" ? "rtl" : "ltr"}
              maxLength={2000}
              value={clause[field]}
              onChange={(event) => {
                onChange({ ...clause, [field]: event.target.value });
              }}
              disabled={pending}
              aria-invalid={Boolean(errors[id])}
              aria-describedby={errors[id] ? `${id}-error` : undefined}
            />
            {errors[id] && (
              <FieldError id={`${id}-error`} message={errors[id]} />
            )}
            {field === "textAr" && suggestionContext && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || suggesting || !clause.textEn.trim()}
                  onClick={request}
                >
                  {t(suggesting ? "suggestion.pending" : "suggestion.request")}
                </Button>
                <p role="status" className="text-caption">
                  {suggesting ? t("suggestion.pending") : ""}
                </p>
                {failure && (
                  <p role="alert" className="text-status-danger-fg">
                    {t(`errors.${failure}`)}
                  </p>
                )}
                {suggestion && (
                  <SuggestionBox
                    value={suggestion.value}
                    locale={suggestionContext.locale}
                    stale={suggestion.source !== clause.textEn}
                    disabled={pending}
                    onUse={() => {
                      onChange({
                        ...clause,
                        textAr: suggestion.value.suggestion.textAr,
                        modelTranslated: true,
                        suggestionId: suggestion.value.suggestionId,
                      });
                      setSuggestion(null);
                    }}
                    onDismiss={() => {
                      setSuggestion(null);
                    }}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
