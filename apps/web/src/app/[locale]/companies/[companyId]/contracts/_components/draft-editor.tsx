"use client";
import { useState, type ReactElement } from "react";
import type { Locale } from "@aqarak/i18n";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { randomCommandKey } from "../_lib/view-helpers";
import { DraftForm } from "./draft-form";
import type {
  ContractDetail,
  DraftingOptions,
  DraftInput,
} from "../_lib/schemas";
export function DraftEditor({
  detail,
  options,
  locale,
  companyId,
  csrfToken,
  commandKey,
}: {
  detail: ContractDetail;
  options: DraftingOptions;
  locale: Locale;
  companyId: string;
  csrfToken: string;
  commandKey: string;
}): ReactElement {
  const [open, setOpen] = useState(true);
  const [formKey, setFormKey] = useState(commandKey);
  const t = useTranslations("Contracts");
  const v = detail.version;
  const initial: DraftInput = {
    tenantId: detail.tenant.id,
    unitId: detail.unit.id,
    termStart: v.termStart,
    termEnd: v.termEnd,
    graceDays: v.graceDays,
    annualRentFils: v.annualRentFils,
    totalFils: v.totalFils,
    depositFils: v.depositFils,
    vatBp: v.vatBp,
    instalments: v.instalments,
    specialClauses: v.specialClauses.map((clause) => ({
      textEn: clause.textEn,
      textAr: clause.textAr,
      modelTranslated: clause.modelTranslated,
    })),
  };
  return (
    <section className="space-y-4">
      <Button
        variant="outline"
        onClick={() => {
          if (!open) setFormKey(randomCommandKey());
          setOpen(!open);
        }}
        aria-expanded={open}
      >
        {t(open ? "closeEdit" : "edit")}
      </Button>
      {open && (
        <DraftForm
          key={v.versionNo}
          initial={initial}
          options={options}
          locale={locale}
          companyId={companyId}
          csrfToken={csrfToken}
          commandKey={formKey}
          contractId={detail.contract.id}
          version={v.versionNo}
          canSuggest={detail.viewer.allowedActions.includes("suggest_clause")}
          onSaved={() => {
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}
