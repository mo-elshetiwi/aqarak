"use client";
import type { ReactElement } from "react";
import { useLocale, useFormatter, useTranslations } from "next-intl";
import { Popover } from "@base-ui/react/popover";
import { Sparkles } from "lucide-react";
import { isLocale } from "@aqarak/i18n";
import { Button } from "@/components/ui/button";
import { DateText } from "@/components/system/formatted-values";
import type { ExtractionProvenance, FieldClass } from "./types";
export function AiLabel({
  provenance,
  documentTitle,
  page,
  fieldClass,
}: {
  provenance: ExtractionProvenance;
  documentTitle: string;
  page: number;
  fieldClass: FieldClass;
}): ReactElement {
  const t = useTranslations("Review");
  const locale = useLocale();
  const format = useFormatter();
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="border-ai-border bg-ai-bg text-ai-fg"
          />
        }
      >
        <Sparkles aria-hidden="true" />
        {t("aiSuggested")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className="z-50">
          <Popover.Popup className="max-w-sm space-y-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-elevation-2">
            <Popover.Title className="text-body-strong">
              {t("extractionDetails")}
            </Popover.Title>
            <dl className="space-y-2 text-caption">
              <div>
                <dt>{t("registry")}</dt>
                <dd>
                  <bdi className="font-mono">{provenance.registryEntry}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("version")}</dt>
                <dd>
                  <bdi className="font-mono">{provenance.version}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("input")}</dt>
                <dd>
                  {documentTitle} · {t("page", { page })}
                </dd>
              </div>
              <div>
                <dt>{t("ranAt")}</dt>
                <dd>
                  <DateText
                    iso={provenance.ranAt}
                    locale={isLocale(locale) ? locale : "en"}
                  />{" "}
                  ·{" "}
                  <bdi>
                    {format.dateTime(new Date(provenance.ranAt), {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Dubai",
                    })}
                  </bdi>
                </dd>
              </div>
            </dl>
            <Popover.Description className="text-caption">
              {t(`limits.${fieldClass}`)}
            </Popover.Description>
            <Popover.Close render={<Button variant="outline" size="sm" />}>
              {t("close")}
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
