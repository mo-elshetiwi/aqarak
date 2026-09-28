"use client";
import type { ReactElement, SubmitEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { bankInputSchema, type OwnerDetail } from "../contract";
import { putBankDetailsAction } from "../actions";
import {
  controlClass,
  EstateHeader,
  Field,
  fieldAccessibility,
  FormFeedback,
  useEstateForm,
  useActionContext,
  estateBase,
} from "./shared";

export function BankDetailsForm({
  companyId,
  owner,
}: {
  companyId: string;
  owner: OwnerDetail;
}): ReactElement {
  const t = useTranslations("Owners");
  const locale = useLocale();
  const router = useRouter();
  const form = useEstateForm("Owners");
  const context = useActionContext(companyId, form.key);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const iban = data.get("iban");
    const parsed = bankInputSchema.safeParse({
      expectedVersion: owner.version,
      bankName: data.get("bankName"),
      accountHolder: data.get("accountHolder"),
      iban:
        typeof iban === "string" ? iban.replaceAll(" ", "").toUpperCase() : "",
    });
    if (!parsed.success) {
      form.setErrors(
        parsed.error.issues.map((issue) => ({
          fieldId: issue.path.join("."),
          message: t("problems.VALIDATION_FAILED"),
        })),
      );
      return;
    }
    form.submit(
      () => putBankDetailsAction(context, parsed.data, [owner.id]),
      () => {
        router.push(
          `${estateBase(locale, companyId)}/owners/${owner.id}?saved=bank`,
        );
      },
    );
  }
  return (
    <div className="max-w-3xl space-y-6">
      <EstateHeader title={t("bankDetails")} description={t("bankHelp")} />
      <form noValidate onSubmit={submit} className="space-y-5">
        <FormFeedback form={form} />
        {(["bankName", "accountHolder", "iban"] as const).map((id) => (
          <Field key={id} id={id} label={t(id)} errors={form.errors}>
            <input
              id={id}
              name={id}
              dir={id === "iban" ? "ltr" : undefined}
              autoComplete="off"
              defaultValue={id === "iban" ? "" : (owner.bank?.[id] ?? "")}
              className={controlClass}
              {...fieldAccessibility(id, form.errors)}
            />
          </Field>
        ))}
        <Button id="form-submit" type="submit" disabled={form.pending}>
          {t(form.pending ? "saving" : "save")}
        </Button>
      </form>
    </div>
  );
}
