"use client";
import { passwordPolicySchema } from "@/lib/api/contract";
import { readPendingInvitation } from "@/components/invitation/pending-invitation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { postJson, navigateDocument } from "@/lib/client/post-json";
import { useCsrfToken } from "@/components/shell/session-context";
import type { FormError } from "@/components/system/screen-states";
const knownCodes = [
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "EMAIL_TAKEN",
  "PASSWORD_POLICY",
  "VALIDATION_FAILED",
  "CODE_MISMATCH",
  "CODE_EXPIRED",
] as const;
interface Submission {
  pending: boolean;
  errors: FormError[];
  code: string;
  submit: (input: {
    path: string;
    body: unknown;
    validation: FormError[];
    fields: string[];
    locale: string;
    confirmed?: boolean;
    onSuccess?: () => void;
  }) => Promise<void>;
}
export function useSubmission(): Submission {
  const translate = useTranslations("Auth");
  const csrfToken = useCsrfToken();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [code, setCode] = useState("");
  async function submit(
    input: Parameters<Submission["submit"]>[0],
  ): Promise<void> {
    if (busy.current) return;
    setCode("");
    const validation = submissionValidation(
      input,
      translate("PASSWORD_POLICY"),
    );
    setErrors(validation);
    if (validation.length) return;
    busy.current = true;
    setPending(true);
    const result = await postJson(
      input.path,
      input.body,
      csrfToken ? { csrfToken } : {},
    );
    if (result.ok) {
      if (input.confirmed)
        navigateDocument(`/${input.locale}/sign-in?confirmed=1`);
      else if (
        input.path === "/api/auth/sign-in" &&
        readPendingInvitation(input.locale)
      )
        navigateDocument(`/${input.locale}/invitation`);
      else if (result.redirectTo) navigateDocument(result.redirectTo);
      else input.onSuccess?.();
    } else if (result.code === "USER_NOT_CONFIRMED") {
      navigateDocument(`/${input.locale}/verify`);
    } else {
      setCode(result.code);
      const key =
        knownCodes.find((item) => item === result.code) ?? "UNAVAILABLE";
      const fields = refusalFields(result.code, input.fields);
      setErrors(
        fields.map((fieldId) => ({ fieldId, message: translate(key) })),
      );
    }
    busy.current = false;
    setPending(false);
  }
  return { pending, errors, code, submit };
}
function refusalFields(code: string, fields: string[]): string[] {
  if (code === "PASSWORD_POLICY") return ["password"];
  if (code === "EMAIL_TAKEN") return ["email"];
  if (code === "CODE_MISMATCH" || code === "CODE_EXPIRED") return ["code"];
  if (code === "VALIDATION_FAILED" || code === "INVALID_CREDENTIALS")
    return fields;
  return fields.slice(0, 1);
}

function submissionValidation(
  input: Parameters<Submission["submit"]>[0],
  message: string,
): FormError[] {
  const validation = [...input.validation];
  if (
    input.path === "/api/auth/sign-up" &&
    typeof input.body === "object" &&
    input.body !== null &&
    "password" in input.body &&
    !passwordPolicySchema.safeParse(input.body.password).success &&
    !validation.some((error) => error.fieldId === "password")
  ) {
    validation.push({ fieldId: "password", message });
  }
  return validation;
}
