"use client";
import type { ReactElement } from "react";
import type { Locale } from "@aqarak/i18n";
import { useTranslations } from "next-intl";
import { Popover } from "@base-ui/react/popover";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateText } from "@/components/system/formatted-values";
import type { ClauseSuggestion } from "../_lib/schemas";
export function SuggestionBox({
  value,
  locale,
  stale,
  disabled,
  onUse,
  onDismiss,
}: {
  value: ClauseSuggestion;
  locale: Locale;
  stale: boolean;
  disabled: boolean;
  onUse: () => void;
  onDismiss: () => void;
}): ReactElement {
  const t = useTranslations("Contracts");
  const p = value.provenance;
  return (
    <section
      className="space-y-3 rounded-lg border border-ai-border bg-ai-bg p-4 text-ai-fg"
      aria-label={t("suggestion.title")}
    >
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="border-ai-border bg-ai-bg text-ai-fg"
            />
          }
        >
          <Sparkles aria-hidden="true" />
          {t("suggestion.label")}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} className="z-50">
            <Popover.Popup className="max-w-sm space-y-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-elevation-2">
              <Popover.Title className="text-body-strong">
                {t("suggestion.details")}
              </Popover.Title>
              <dl className="space-y-2 text-caption">
                <div>
                  <dt>{t("suggestion.model")}</dt>
                  <dd>
                    <bdi>{p.registryEntry}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{t("suggestion.prompt")}</dt>
                  <dd>
                    <bdi>{p.promptVersion}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{t("suggestion.time")}</dt>
                  <dd>
                    {p.ranAt ? (
                      <>
                        <DateText iso={p.ranAt} locale={locale} /> ·{" "}
                        <bdi>
                          {new Intl.DateTimeFormat(`${locale}-AE-u-nu-latn`, {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Dubai",
                          }).format(new Date(p.ranAt))}
                        </bdi>
                      </>
                    ) : (
                      t("suggestion.unknownTime")
                    )}
                  </dd>
                </div>
              </dl>
              <Popover.Description className="text-caption">
                {t("suggestion.review")}
              </Popover.Description>
              <Popover.Close
                render={<Button type="button" variant="outline" size="sm" />}
              >
                {t("suggestion.close")}
              </Popover.Close>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <p lang="ar" dir="rtl" className="whitespace-pre-wrap">
        {value.suggestion.textAr}
      </p>
      {value.suggestion.warnings.length > 0 && (
        <ul className="list-inside list-disc">
          {value.suggestion.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
      {stale && <p role="status">{t("suggestion.stale")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || stale}
          onClick={onUse}
        >
          {t("suggestion.use")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onDismiss}
        >
          {t("suggestion.dismiss")}
        </Button>
      </div>
    </section>
  );
}
