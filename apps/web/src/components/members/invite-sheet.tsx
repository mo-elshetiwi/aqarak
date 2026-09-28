"use client";
import { useRef, useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { domainLabel, type Locale } from "@aqarak/i18n";
import { z } from "zod";
import { FormField, SubmitButton } from "@/components/auth/form-controls";
import {
  ErrorSummary,
  FieldError,
  type FormError,
} from "@/components/system/screen-states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useCsrfToken } from "@/components/shell/session-context";
import { emailSchema, type StaffRole } from "@/lib/api/contract";
import { invitationLinkSchema } from "@/lib/auth/schemas";
import { postJsonData } from "@/lib/client/post-json";
import { formatDate } from "@/lib/format";

export function InvitationLinkPanel({
  result,
}: {
  result: z.infer<typeof invitationLinkSchema>;
}): ReactElement {
  const t = useTranslations("Members");
  const locale = useLocale() as Locale;
  const [copyState, setCopyState] = useState<"copied" | "copyFailed" | null>(
    null,
  );
  return (
    <div className="space-y-6 p-4">
      <div
        role="status"
        className="space-y-2 rounded-md border border-status-success-border bg-status-success-bg p-4 text-status-success-fg"
      >
        <h3 className="text-h3">{t("created")}</h3>
        <p>{t(result.invitation.deliveryStatus)}</p>
      </div>
      {result.inviteUrl ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="invitation-link">{t("link")}</Label>
            <Input
              id="invitation-link"
              dir="ltr"
              readOnly
              value={result.inviteUrl}
              onFocus={(event) => {
                event.target.select();
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(result.inviteUrl ?? "");
                    setCopyState("copied");
                  } catch {
                    setCopyState("copyFailed");
                  }
                })();
              }}
            >
              {t("copy")}
            </Button>
            {copyState && <p role="status">{t(copyState)}</p>}
          </div>
          <p className="text-body text-muted-foreground">{t("once")}</p>
        </>
      ) : (
        <p role="alert">{t("linkUnavailable")}</p>
      )}
      <p>
        {t("expires")}:{" "}
        <time dateTime={result.invitation.expiresAt} dir="ltr">
          {formatDate(result.invitation.expiresAt, locale)}
        </time>
      </p>
    </div>
  );
}
export function InviteForm({ companyId }: { companyId: string }): ReactElement {
  const t = useTranslations("Members");
  const locale = useLocale() as Locale;
  const csrfToken = useCsrfToken();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [email, setEmail] = useState("");
  const [staffRoles, setRoles] = useState<StaffRole[]>([]);
  const [inviteLocale, setInviteLocale] = useState<Locale>(locale);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<z.infer<
    typeof invitationLinkSchema
  > | null>(null);
  const busy = useRef(false);
  async function submit(): Promise<void> {
    if (busy.current) return;
    const invalid: FormError[] = [];
    if (!emailSchema.safeParse(email).success)
      invalid.push({ fieldId: "invite-email", message: t("invalidEmail") });
    if (!staffRoles.length)
      invalid.push({ fieldId: "invite-roles", message: t("roleRequired") });
    setErrors(invalid);
    if (invalid.length) return;
    busy.current = true;
    setPending(true);
    const response = await postJsonData(
      `/api/companies/${companyId}/invitations`,
      { locale, email, staffRoles, inviteLocale, idempotencyKey },
      invitationLinkSchema,
      csrfToken ? { csrfToken } : {},
    );
    if (response.ok) setResult(response.data);
    else {
      const code =
        (
          [
            "INVITATION_EXISTS",
            "VALIDATION_FAILED",
            "FORBIDDEN",
            "IDEMPOTENCY_KEY_REUSED",
          ] as const
        ).find((code) => code === response.code) ?? "UNAVAILABLE";
      setErrors([
        {
          fieldId:
            code === "INVITATION_EXISTS" || code === "VALIDATION_FAILED"
              ? "invite-email"
              : "invite-submit",
          message: t(code),
        },
      ]);
    }
    busy.current = false;
    setPending(false);
  }
  if (result) return <InvitationLinkPanel result={result} />;
  return (
    <form
      noValidate
      className="space-y-6 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ErrorSummary errors={errors} />
      <FormField
        id="invite-email"
        label={t("email")}
        type="email"
        dir="ltr"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
        errors={errors}
      />
      <fieldset
        id="invite-roles"
        tabIndex={-1}
        className="space-y-3"
        aria-describedby={
          errors.some((item) => item.fieldId === "invite-roles")
            ? "invite-roles-error"
            : undefined
        }
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
              checked={staffRoles.includes(role)}
              onCheckedChange={(checked) => {
                setRoles((roles) =>
                  checked
                    ? [...roles, role]
                    : roles.filter((item) => item !== role),
                );
              }}
            />
            {domainLabel(locale, "staffRole", role)}
          </Label>
        ))}
        {errors.some((item) => item.fieldId === "invite-roles") && (
          <FieldError id="invite-roles-error" message={t("roleRequired")} />
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-label">{t("inviteLocale")}</legend>
        <RadioGroup
          value={inviteLocale}
          onValueChange={(value: unknown) => {
            if (value === "en" || value === "ar") setInviteLocale(value);
          }}
        >
          <Label lang="en">
            <RadioGroupItem value="en" />
            {t("english")}
          </Label>
          <Label lang="ar">
            <RadioGroupItem value="ar" />
            {t("arabic")}
          </Label>
        </RadioGroup>
      </fieldset>
      <div id="invite-submit" tabIndex={-1}>
        <SubmitButton label={t("send")} pending={pending} />
      </div>
    </form>
  );
}
export function InviteSheet({
  companyId,
}: {
  companyId: string;
}): ReactElement {
  const t = useTranslations("Members");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) router.refresh();
      }}
    >
      <SheetTrigger
        render={<Button variant={open ? "secondary" : "default"} />}
      >
        {t("invite")}
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader className="pe-14">
          <SheetTitle>{t("invite")}</SheetTitle>
          <SheetDescription>{t("inviteDescription")}</SheetDescription>
        </SheetHeader>
        {open && <InviteForm companyId={companyId} />}
      </SheetContent>
    </Sheet>
  );
}
