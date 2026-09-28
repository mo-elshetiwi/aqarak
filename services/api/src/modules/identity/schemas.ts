import { z } from "zod";
export const email = z.string().trim().toLowerCase().pipe(z.email());
export const locale = z.enum(["en", "ar"]);
export const name = z.object({
  en: z.string().trim().min(2).max(120),
  ar: z.string().trim().min(2).max(120),
});
export const staffRole = z.enum([
  "manager",
  "technician",
  "company_administrator",
  "accountant",
]);
export const roles = z
  .array(staffRole)
  .min(1)
  .max(4)
  .refine((value) => new Set(value).size === value.length);
export const expectedVersion = z.number().int().min(1);
export const reason = z.string().trim().min(1).max(2000);
export const tokenBody = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const companyCreate = z
  .object({
    kind: z.enum(["management_company", "self_managed_owner"]),
    name,
    tradeLicenceNumber: z.string().trim().min(1).max(40).optional(),
  })
  .refine(
    (value) =>
      value.kind !== "management_company" || Boolean(value.tradeLicenceNumber),
  );
export const companyPatch = z
  .object({
    expectedVersion,
    name: name.optional(),
    tradeLicenceNumber: z.string().trim().min(1).max(40).nullable().optional(),
    trn: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.tradeLicenceNumber !== undefined ||
      value.trn !== undefined,
  );
export const signUp = z.object({
  email,
  password: z.string().min(1).max(256),
  fullName: z.string().trim().min(2).max(120),
  locale,
});
export const signIn = z.discriminatedUnion("client", [
  z.object({
    client: z.literal("web"),
    email,
    password: z.string().min(1).max(256),
  }),
  z.object({
    client: z.literal("mobile"),
    username: email,
    password: z.string().min(1).max(256),
  }),
]);
