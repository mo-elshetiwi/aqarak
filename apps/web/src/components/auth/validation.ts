import type { FormError } from "@/components/system/screen-states";
import { emailSchema, passwordPolicySchema } from "@/lib/api/contract";
type Translate = (
  key:
    | "required"
    | "invalidEmail"
    | "invalidName"
    | "invalidCode"
    | "PASSWORD_POLICY",
) => string;
export function validateFields(
  values: Record<string, string>,
  translate: Translate,
): FormError[] {
  return Object.entries(values).flatMap(([fieldId, value]) => {
    const key = invalidField(fieldId, value);
    return key ? [{ fieldId, message: translate(key) }] : [];
  });
}
function invalidField(
  field: string,
  value: string,
): Parameters<Translate>[0] | null {
  if (!value.trim()) return "required";
  if (field === "email" && !emailSchema.safeParse(value).success)
    return "invalidEmail";
  if (
    ["fullName", "nameEn", "nameAr"].includes(field) &&
    (value.trim().length < 2 || value.trim().length > 120)
  )
    return "invalidName";
  if (field === "code" && !/^\d{6}$/.test(value)) return "invalidCode";
  return null;
}
export function validatePassword(
  password: string,
  message: string,
): FormError[] {
  return passwordPolicySchema.safeParse(password).success
    ? []
    : [{ fieldId: "password", message }];
}
