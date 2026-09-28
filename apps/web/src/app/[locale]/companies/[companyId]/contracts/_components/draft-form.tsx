"use client";
import {
  useState,
  useTransition,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Locale } from "@aqarak/i18n";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmptyState,
  ErrorSummary,
  FieldError,
} from "@/components/system/screen-states";
import { createContract, editContract } from "../_lib/actions";
import {
  draftInputSchema,
  termsInputSchema,
  type ActionResult,
  type DraftInput,
  type DraftingOptions,
} from "../_lib/schemas";
import { fieldId, parseFils, rowsFrom } from "../_lib/draft-helpers";
import { randomCommandKey } from "../_lib/view-helpers";
import { ClauseFields } from "./clause-fields";
import { InstalmentBuilder } from "./instalment-builder";
interface Props {
  options: DraftingOptions;
  locale: Locale;
  companyId: string;
  csrfToken: string;
  commandKey: string;
  initial?: DraftInput;
  contractId?: string;
  version?: number;
  onSaved?: () => void;
  canSuggest?: boolean;
}
const selectClass =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export function DraftForm({
  options,
  locale,
  companyId,
  csrfToken,
  commandKey,
  initial,
  contractId,
  version,
  onSaved,
  canSuggest = false,
}: Props): ReactElement {
  const t = useTranslations("Contracts");
  const router = useRouter();
  const [key, setKey] = useState(commandKey);
  const [rows, setRows] = useState(() => rowsFrom(initial));
  const [total, setTotal] = useState(
    initial ? String(initial.totalFils / 100) : "85000",
  );
  const [selectedUnit, setSelectedUnit] = useState(initial?.unitId ?? "");
  const [selectedTenant, setSelectedTenant] = useState(initial?.tenantId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [clauses, setClauses] = useState<DraftInput["specialClauses"]>(() =>
    initial?.specialClauses.length
      ? initial.specialClauses
      : [{ textEn: "", textAr: "", modelTranslated: false }],
  );
  const unit = options.units.find((item) => item.id === selectedUnit);
  const tenant = options.tenants.find((item) => item.id === selectedTenant);
  function submit(form: FormData): void {
    if (pending) return;
    const text = (name: string): string => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const rate = Number(text("vatBp"));
    const raw = {
      tenantId: selectedTenant,
      unitId: selectedUnit,
      termStart: text("termStart"),
      termEnd: text("termEnd"),
      graceDays: Number(text("graceDays")),
      annualRentFils: parseFils(text("annualRentFils")),
      totalFils: parseFils(total),
      depositFils: parseFils(text("depositFils")),
      vatBp: rate,
      instalments: rows.map((row, index) => ({
        seqNo: index + 1,
        dueOn: row.dueOn,
        amountFils: parseFils(row.amount),
        vatFils: Math.floor((parseFils(row.amount) * rate + 5000) / 10000),
        cheque:
          row.chequeNo.trim() || row.bankName.trim()
            ? {
                chequeNo: row.chequeNo.trim(),
                bankName: row.bankName.trim(),
              }
            : null,
      })),
      specialClauses: clauses.filter(
        (item) => item.textEn.trim() || item.textAr.trim(),
      ),
    };
    const parsed = draftInputSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            fieldId(issue.path.join(".")),
            t("errors.INVALID_INPUT"),
          ]),
        ),
      );
      return;
    }
    if (
      parsed.data.instalments.reduce((sum, row) => sum + row.amountFils, 0) !==
      parsed.data.totalFils
    ) {
      setErrors({ instalments: t("errors.SCHEDULE_TOTAL_MISMATCH") });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const envelope = {
        locale,
        companyId,
        csrfToken: form.get("csrfToken"),
        idempotencyKey: key,
      };
      let result: ActionResult;
      try {
        result = contractId
          ? await editContract({
              ...envelope,
              contractId,
              input: {
                expectedVersion: version,
                terms: termsInputSchema.strip().parse(parsed.data),
              },
            })
          : await createContract({ ...envelope, input: parsed.data });
      } catch {
        setKey(randomCommandKey());
        setErrors({ "save-draft": t("errors.UNAVAILABLE") });
        return;
      }
      if (!result.ok) {
        setKey(randomCommandKey());
        const field =
          result.code === "SCHEDULE_TOTAL_MISMATCH"
            ? "instalments"
            : fieldId(result.field ?? "save-draft");
        setErrors({ [field]: t(`errors.${result.code}`) });
        return;
      }
      onSaved?.();
      router.push(
        `/${locale}/companies/${companyId}/contracts/${result.contractId}`,
      );
      router.refresh();
    });
  }
  if (draftingUnavailable(options, contractId))
    return (
      <EmptyState
        variant="no-records"
        message={t("noDraftingOptions")}
        actionLabel={t("back")}
        onAction={() => {
          router.push(`/${locale}/companies/${companyId}/contracts`);
        }}
      />
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
      noValidate
      className="space-y-6"
    >
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <ErrorSummary
        errors={Object.entries(errors).map(([fieldId, message]) => ({
          fieldId,
          message,
        }))}
      />
      <PartiesFields
        options={options}
        locale={locale}
        selectedUnit={selectedUnit}
        selectedTenant={selectedTenant}
        setSelectedUnit={setSelectedUnit}
        setSelectedTenant={setSelectedTenant}
        pending={pending || Boolean(contractId)}
        errors={errors}
        unit={unit}
      />
      <TermFields
        initial={initial}
        total={total}
        setTotal={setTotal}
        pending={pending}
        errors={errors}
      />
      <InstalmentBuilder
        rows={rows}
        onChange={setRows}
        totalFils={parseFils(total)}
        locale={locale}
        disabled={pending}
        errors={errors}
      />
      <ClauseFields
        clauses={clauses}
        setClauses={setClauses}
        {...(canSuggest && contractId
          ? { suggestionContext: { locale, companyId, csrfToken, contractId } }
          : {})}
        pending={pending}
        errors={errors}
      />
      <RuleChecks unit={unit} tenant={tenant} />
      <Button
        id="save-draft"
        type="submit"
        variant={contractId ? "secondary" : "default"}
        disabled={pending}
      >
        {pending ? t("saving") : t(contractId ? "saveChanges" : "saveDraft")}
      </Button>
      <p role="status" aria-live="polite">
        {pending ? t("saving") : ""}
      </p>
    </form>
  );
}
function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <FieldError id={`${id}-error`} message={error} />}
    </div>
  );
}
function DraftInputField({
  id,
  initial,
  type = "text",
  errors,
  disabled,
}: {
  id: string;
  initial: string;
  type?: string;
  errors: Record<string, string>;
  disabled: boolean;
}): ReactElement {
  const t = useTranslations("Contracts");
  return (
    <FormField id={id} label={t(id)} error={errors[id]}>
      <Input
        id={id}
        name={id}
        type={type}
        defaultValue={initial}
        inputMode={type === "text" ? "decimal" : undefined}
        disabled={disabled}
        aria-invalid={Boolean(errors[id])}
        aria-describedby={errors[id] ? `${id}-error` : undefined}
      />
    </FormField>
  );
}

function PartiesFields({
  options,
  locale,
  selectedUnit,
  selectedTenant,
  setSelectedUnit,
  setSelectedTenant,
  pending,
  errors,
  unit,
}: {
  options: DraftingOptions;
  locale: Locale;
  selectedUnit: string;
  selectedTenant: string;
  setSelectedUnit: (value: string) => void;
  setSelectedTenant: (value: string) => void;
  pending: boolean;
  errors: Record<string, string>;
  unit: DraftingOptions["units"][number] | undefined;
}): ReactElement {
  const t = useTranslations("Contracts");
  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <h2 className="text-h2">{t("parties")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="unitId" label={t("unit")} error={errors.unitId}>
          <select
            id="unitId"
            name="unitId"
            className={selectClass}
            value={selectedUnit}
            onChange={(event) => {
              setSelectedUnit(event.target.value);
            }}
            disabled={pending}
            aria-invalid={Boolean(errors.unitId)}
            aria-describedby={errors.unitId ? "unitId-error" : undefined}
          >
            <option value="">{t("select")}</option>
            {options.units.map((item) => (
              <option key={item.id} value={item.id}>
                {item.propertyName[locale]} · {item.unitNo}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="tenantId" label={t("tenant")} error={errors.tenantId}>
          <select
            id="tenantId"
            name="tenantId"
            className={selectClass}
            value={selectedTenant}
            onChange={(event) => {
              setSelectedTenant(event.target.value);
            }}
            disabled={pending}
            aria-invalid={Boolean(errors.tenantId)}
            aria-describedby={errors.tenantId ? "tenantId-error" : undefined}
          >
            <option value="">{t("select")}</option>
            {options.tenants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name[locale]}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      {unit?.owner && (
        <p>
          {t("owner")}: <bdi>{unit.owner.name[locale]}</bdi>
        </p>
      )}
    </section>
  );
}

function TermFields({
  initial,
  total,
  setTotal,
  pending,
  errors,
}: {
  initial: DraftInput | undefined;
  total: string;
  setTotal: (value: string) => void;
  pending: boolean;
  errors: Record<string, string>;
}): ReactElement {
  const t = useTranslations("Contracts");
  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <h2 className="text-h2">{t("term")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DraftInputField
          id="termStart"
          type="date"
          initial={initial?.termStart ?? ""}
          errors={errors}
          disabled={pending}
        />
        <DraftInputField
          id="termEnd"
          type="date"
          initial={initial?.termEnd ?? ""}
          errors={errors}
          disabled={pending}
        />
        <DraftInputField
          id="graceDays"
          type="number"
          initial={String(initial?.graceDays ?? 0)}
          errors={errors}
          disabled={pending}
        />
        <DraftInputField
          id="annualRentFils"
          initial={String((initial?.annualRentFils ?? 8500000) / 100)}
          errors={errors}
          disabled={pending}
        />
        <FormField
          id="totalFils"
          label={t("totalFils")}
          error={errors.totalFils}
        >
          <Input
            id="totalFils"
            name="totalFils"
            inputMode="decimal"
            value={total}
            onChange={(event) => {
              setTotal(event.target.value);
            }}
            disabled={pending}
            aria-invalid={Boolean(errors.totalFils)}
            aria-describedby={errors.totalFils ? "totalFils-error" : undefined}
          />
        </FormField>
        <DraftInputField
          id="depositFils"
          initial={String((initial?.depositFils ?? 0) / 100)}
          errors={errors}
          disabled={pending}
        />
        <FormField id="vatBp" label={t("vatBp")} error={errors.vatBp}>
          <select
            id="vatBp"
            name="vatBp"
            className={selectClass}
            defaultValue={initial?.vatBp ?? 0}
            disabled={pending}
          >
            <option value="0">{t("vatZero")}</option>
            <option value="500">{t("vatFive")}</option>
          </select>
        </FormField>
      </div>
    </section>
  );
}

function RuleChecks({
  unit,
  tenant,
}: {
  unit: DraftingOptions["units"][number] | undefined;
  tenant: DraftingOptions["tenants"][number] | undefined;
}): ReactElement {
  const t = useTranslations("Contracts");
  return (
    <section className="space-y-2 rounded-lg border bg-muted p-6">
      <h2 className="text-h2">{t("ruleChecks")}</h2>
      {tenant && (
        <p>
          {t(
            tenant.documentsAccepted ? "documentsAccepted" : "documentsNeeded",
          )}
        </p>
      )}
      {unit && (
        <>
          <p>{t(unit.ownerGate ? "ownerGateOn" : "ownerGateOff")}</p>
          {unit.ownerGate && (
            <p>{t(unit.owner?.hasAccount ? "ownerReady" : "ownerNeeded")}</p>
          )}
        </>
      )}
    </section>
  );
}

function draftingUnavailable(
  options: DraftingOptions,
  contractId: string | undefined,
): boolean {
  return !contractId && (!options.units.length || !options.tenants.length);
}
