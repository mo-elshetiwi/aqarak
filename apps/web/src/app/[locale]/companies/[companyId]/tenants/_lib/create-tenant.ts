import { z } from "zod";
export const createTenantSchema = z.object({
  kind: z.literal("individual"),
  fullNameEn: z.string().trim().min(2).max(120),
  fullNameAr: z.string().trim().min(2).max(120).optional(),
  email: z.email().max(320),
  phoneE164: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/)
    .optional(),
  preferredLanguage: z.enum(["en", "ar"]),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export const createTenantValuesSchema = z.object({
  fullNameEn: z.string(),
  fullNameAr: z.string(),
  email: z.string(),
  phoneE164: z.string(),
  preferredLanguage: z.enum(["en", "ar", ""]),
});
export type CreateTenantValues = z.infer<typeof createTenantValuesSchema>;
export const createFields = [
  "fullNameEn",
  "fullNameAr",
  "email",
  "phoneE164",
  "preferredLanguage",
] as const;
export type CreateField = (typeof createFields)[number];
export function parseCreateTenant(
  values: CreateTenantValues,
): ReturnType<typeof createTenantSchema.safeParse> {
  return createTenantSchema.safeParse({
    kind: "individual",
    fullNameEn: values.fullNameEn,
    ...(values.fullNameAr.trim() ? { fullNameAr: values.fullNameAr } : {}),
    email: values.email.trim(),
    ...(values.phoneE164.trim() ? { phoneE164: values.phoneE164.trim() } : {}),
    preferredLanguage: values.preferredLanguage,
  });
}
