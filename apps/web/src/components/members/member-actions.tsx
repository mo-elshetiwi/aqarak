"use client";
import { useRef, useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { domainLabel, type Locale } from "@aqarak/i18n";
import type { Membership, StaffRole } from "@/lib/api/contract";
import { postJsonData } from "@/lib/client/post-json";
import { useCsrfToken } from "@/components/shell/session-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FormField, SubmitButton } from "@/components/auth/form-controls";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
export type MemberAction = "roles" | "suspend" | "reactivate" | "remove";
export const actionLabels = {
  roles: "changeRoles",
  suspend: "suspend",
  reactivate: "reactivate",
  remove: "remove",
} as const;
const refusalCodes = [
  "VERSION_CONFLICT",
  "LAST_ADMINISTRATOR",
  "ACTIVE_MEMBERSHIP_ELSEWHERE",
  "FORBIDDEN",
  "UNAVAILABLE",
  "INVITATION_NOT_PENDING",
  "IDEMPOTENCY_KEY_REUSED",
  "SESSION_INVALID",
  "NOT_FOUND",
] as const;
export function ActionError({
  code,
  onReload,
}: {
  code: string | null;
  onReload: () => void;
}): ReactElement | null {
  const t = useTranslations("Members");
  if (!code) return null;
  const key = refusalCodes.find((item) => item === code) ?? "UNAVAILABLE";
  return (
    <div
      role="alert"
      className="space-y-3 rounded-md border border-status-danger-border bg-status-danger-bg p-4 text-status-danger-fg"
    >
      <p>{t(key)}</p>
      {code === "VERSION_CONFLICT" && (
        <Button type="button" variant="outline" onClick={onReload}>
          {t("reload")}
        </Button>
      )}
    </div>
  );
}
export function MemberActionForm({
  companyId,
  member,
  action,
  onDone,
  onReload,
}: {
  companyId: string;
  member: Membership;
  action: MemberAction;
  onDone: () => void;
  onReload: () => void;
}): ReactElement {
  const t = useTranslations("Members");
  const locale = useLocale() as Locale;
  const csrfToken = useCsrfToken();
  const [roles, setRoles] = useState<StaffRole[]>(member.staffRoles);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const attempt = useRef({ body: "", key: crypto.randomUUID() });
  const needsReason = action === "suspend" || action === "remove";
  async function submit(): Promise<void> {
    if (busy.current) return;
    if (
      (needsReason && (!reason.trim() || reason.trim().length > 2000)) ||
      (action === "roles" && !roles.length)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setCode(null);
    busy.current = true;
    setPending(true);
    const input = {
      locale,
      expectedVersion: member.version,
      ...(needsReason ? { reason: reason.trim() } : {}),
      ...(action === "roles" ? { staffRoles: roles } : {}),
    };
    const body = JSON.stringify(input);
    if (attempt.current.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    const result = await postJsonData(
      `/api/companies/${companyId}/members/${member.membershipId}/${action}`,
      { ...input, idempotencyKey: attempt.current.key },
      z.object({ ok: z.literal(true) }),
      csrfToken ? { csrfToken } : {},
    );
    busy.current = false;
    setPending(false);
    if (result.ok) onDone();
    else setCode(result.code);
  }
  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {action === "roles" && (
        <fieldset
          className="space-y-3"
          aria-describedby={invalid ? "member-role-error" : undefined}
        >
          <legend className="mb-2 text-label">{t("roles")}</legend>
          {(
            [
              "manager",
              "accountant",
              "technician",
              "company_administrator",
            ] as const
          ).map((role) => (
            <Label key={role} className="flex min-h-6 items-center gap-2">
              <Checkbox
                checked={roles.includes(role)}
                onCheckedChange={(checked) => {
                  setRoles((current) =>
                    checked
                      ? [...current, role]
                      : current.filter((item) => item !== role),
                  );
                }}
              />
              {domainLabel(locale, "staffRole", role)}
            </Label>
          ))}
          {invalid && (
            <p role="alert" id="member-role-error">
              {t("roleRequired")}
            </p>
          )}
        </fieldset>
      )}
      {needsReason && (
        <FormField
          id="member-reason"
          label={t("reason")}
          value={reason}
          maxLength={2000}
          required
          onChange={(event) => {
            setReason(event.target.value);
          }}
          errors={
            invalid
              ? [{ fieldId: "member-reason", message: t("reasonRequired") }]
              : []
          }
        />
      )}
      <ActionError code={code} onReload={onReload} />
      <SubmitButton
        pending={pending}
        label={t(code === "UNAVAILABLE" ? "retry" : actionLabels[action])}
      />
    </form>
  );
}
export function MemberActions({
  companyId,
  member,
  own,
}: {
  companyId: string;
  member: Membership;
  own: boolean;
}): ReactElement | null {
  const t = useTranslations("Members");
  const router = useRouter();
  const [action, setAction] = useState<MemberAction | null>(null);
  if (member.status === "removed") return null;
  const close = (): void => {
    setAction(null);
    router.refresh();
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              aria-label={t("actionsFor", {
                name: member.displayName ?? member.email ?? t("notAvailable"),
              })}
            />
          }
        >
          {t("actions")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setAction("roles");
            }}
          >
            {t("changeRoles")}
          </DropdownMenuItem>
          {!own && member.status === "active" && (
            <DropdownMenuItem
              onClick={() => {
                setAction("suspend");
              }}
            >
              {t("suspend")}
            </DropdownMenuItem>
          )}
          {!own && member.status === "suspended" && (
            <DropdownMenuItem
              onClick={() => {
                setAction("reactivate");
              }}
            >
              {t("reactivate")}
            </DropdownMenuItem>
          )}
          {!own && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setAction("remove");
              }}
            >
              {t("remove")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader className="pe-8">
            <DialogTitle>
              {action ? t(actionLabels[action]) : t("actions")}
            </DialogTitle>
            <DialogDescription>
              {action === "remove"
                ? t("removeConsequence")
                : t("memberActionDescription", {
                    name: member.displayName ?? t("notAvailable"),
                  })}
            </DialogDescription>
          </DialogHeader>
          {action && (
            <MemberActionForm
              key={`${String(member.version)}:${action}`}
              companyId={companyId}
              member={member}
              action={action}
              onDone={close}
              onReload={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
