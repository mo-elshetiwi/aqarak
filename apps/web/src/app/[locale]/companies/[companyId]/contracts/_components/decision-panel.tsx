"use client";
import { useRef, useState, useTransition, type ReactElement } from "react";
import type { Locale } from "@aqarak/i18n";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ErrorSummary, FieldError } from "@/components/system/screen-states";
import {
  approveOwner,
  acceptTenant,
  returnOwner,
  returnTenant,
  submitContract,
  cancelContract,
  withdrawContract,
  reviseContract,
} from "../_lib/actions";
import { randomCommandKey } from "../_lib/view-helpers";
import type {
  AllowedAction,
  ActionResult,
  ContractDetail,
} from "../_lib/schemas";
const commands = {
  submit: submitContract,
  approve_owner: approveOwner,
  accept_tenant: acceptTenant,
  return_owner: returnOwner,
  return_tenant: returnTenant,
  withdraw: withdrawContract,
  cancel_draft: cancelContract,
  revise: reviseContract,
};
type Decision = keyof typeof commands;
function isDecision(value: AllowedAction): value is Decision {
  return value in commands;
}
function needsReason(action: Decision): boolean {
  return ["return_owner", "return_tenant", "withdraw", "cancel_draft"].includes(
    action,
  );
}
export function DecisionPanel({
  detail,
  locale,
  companyId,
  csrfToken,
  onFailure,
}: {
  detail: ContractDetail;
  locale: Locale;
  companyId: string;
  csrfToken: string;
  onFailure?: (failure: Extract<ActionResult, { ok: false }> | null) => void;
}): ReactElement {
  const t = useTranslations("Approvals");
  const c = useTranslations("Contracts");
  const router = useRouter();
  const [active, setActive] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<Extract<
    ActionResult,
    { ok: false }
  > | null>(null);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const actions = detail.viewer.allowedActions.filter(isDecision);
  const version = detail.version.versionNo;
  function effect(action: Decision): string {
    const values = {
      version,
      tenant: detail.tenant.name[locale],
      owner: detail.owner?.name[locale] ?? "",
    };
    if (action === "submit")
      return t(
        detail.ownerGate.value ? "submitEffectOwner" : "submitEffectTenant",
        values,
      );
    if (action === "approve_owner") return t("approveEffect", values);
    if (action === "accept_tenant") return t("acceptEffect", values);
    if (action === "return_owner" || action === "return_tenant")
      return t("returnEffect");
    if (action === "withdraw") return t("withdrawEffect", values);
    if (action === "cancel_draft") return t("cancelEffect", values);
    return t("reviseEffect");
  }
  function fail(value: Extract<ActionResult, { ok: false }>): void {
    setFailure(value);
    onFailure?.(value);
  }
  function close(): void {
    if (pending) return;
    setActive(null);
    trigger.current?.focus();
  }
  function confirm(form: FormData): void {
    if (!active || pending) return;
    if (needsReason(active) && !reason.trim()) {
      setFailure({ ok: false, code: "REASON_REQUIRED", field: "reason" });
      return;
    }
    const input = {
      expectedVersion: version,
      ...(needsReason(active) ? { reason } : {}),
      ...(active === "approve_owner" || active === "accept_tenant"
        ? { subjectHash: detail.version.contentHash }
        : {}),
    };
    const action = active;
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = await commands[action]({
          locale,
          companyId,
          contractId: detail.contract.id,
          input,
          csrfToken: form.get("csrfToken"),
          idempotencyKey: randomCommandKey(),
        });
      } catch {
        fail({ ok: false, code: "UNAVAILABLE" });
        return;
      }
      if (!result.ok) {
        fail(result);
        return;
      }
      setFailure(null);
      onFailure?.(null);
      setSaved(true);
      setActive(null);
      trigger.current?.focus();
      if (result.contractId !== detail.contract.id)
        router.push(
          `/${locale}/companies/${companyId}/contracts/${result.contractId}`,
        );
      router.refresh();
    });
  }
  const primary = actions.find((action) =>
    ["submit", "approve_owner", "accept_tenant", "revise"].includes(action),
  );
  const errorMessage = refusalMessage(failure, c);
  return (
    <aside
      className="space-y-5 rounded-lg border bg-card p-6"
      aria-labelledby="decision-heading"
    >
      <h2 id="decision-heading" className="text-h2">
        {t(detail.viewer.slot === "manager" ? "submitPanel" : "decisionPanel")}
      </h2>
      <ol className="space-y-2 text-body-dense">
        <li>{t("nextManager")}</li>
        {detail.ownerGate.value && <li>{t("nextOwner")}</li>}
        <li>{t("nextTenant")}</li>
      </ol>
      {primary && (
        <p className="text-body-dense text-muted-foreground">
          {effect(primary)}
        </p>
      )}
      {!actions.length && <p>{t("noActions")}</p>}
      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <Button
            key={action}
            variant={action === primary && !active ? "default" : "outline"}
            disabled={pending}
            onClick={(event) => {
              trigger.current = event.currentTarget;
              setActive(action);
              setReason("");
              setFailure(null);
              setSaved(false);
            }}
          >
            {t(action, { version })}
          </Button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-body-dense">
        {pending ? t("pending") : saved ? t("done") : ""}
      </p>
      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent showCloseButton={!pending} finalFocus={trigger}>
          <DialogTitle>
            {active ? t(active, { version }) : t("decisionPanel")}
          </DialogTitle>
          <DialogDescription>{active ? effect(active) : ""}</DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirm(new FormData(event.currentTarget));
            }}
            noValidate
            className="space-y-4"
          >
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <ErrorSummary
              errors={
                failure
                  ? [
                      {
                        fieldId: confirmationField(failure, active),
                        message: errorMessage,
                      },
                    ]
                  : []
              }
            />
            <ReasonField
              visible={active !== null && needsReason(active)}
              reason={reason}
              onChange={(value) => {
                setReason(value);
                setFailure(null);
              }}
              pending={pending}
              invalid={failure?.field === "reason"}
              errorMessage={errorMessage}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={close}
                disabled={pending}
              >
                {t("close")}
              </Button>
              <Button id="confirm-command" type="submit" disabled={pending}>
                {pending ? t("pending") : t("confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function ReasonField({
  visible,
  reason,
  onChange,
  pending,
  invalid,
  errorMessage,
}: {
  visible: boolean;
  reason: string;
  onChange: (value: string) => void;
  pending: boolean;
  invalid: boolean;
  errorMessage: string;
}): ReactElement | null {
  const t = useTranslations("Approvals");
  if (!visible) return null;
  return (
    <div className="space-y-2">
      <Label htmlFor="reason">{t("reason")}</Label>
      <p id="reason-hint" className="text-caption text-muted-foreground">
        {t("reasonHint")}
      </p>
      <Textarea
        id="reason"
        name="reason"
        value={reason}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        required
        maxLength={1000}
        aria-invalid={invalid}
        aria-describedby={invalid ? "reason-hint reason-error" : "reason-hint"}
        disabled={pending}
      />
      {invalid && <FieldError id="reason-error" message={errorMessage} />}
    </div>
  );
}

function refusalMessage(
  failure: Extract<ActionResult, { ok: false }> | null,
  t: ReturnType<typeof useTranslations<"Contracts">>,
): string {
  return failure ? t(`errors.${failure.code}`) : "";
}

function confirmationField(
  failure: Extract<ActionResult, { ok: false }>,
  active: Decision | null,
): string {
  if (failure.code === "SCHEDULE_TOTAL_MISMATCH") return "contract-instalments";
  return needsReason(active ?? "submit") ? "reason" : "confirm-command";
}
