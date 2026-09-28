import { z } from "zod";
import {
  idempotencyKeySchema,
  staffRolesSchema,
  invitationSchema,
  companyKindSchema,
  companyNameSchema,
  confirmSignUpInputSchema,
  emailSchema,
  localeSchema,
  signInInputSchema,
  signUpInputSchema,
} from "../api/contract";
export const signUpSchema = signUpInputSchema;
export const confirmSignUpSchema = z.object({
  locale: localeSchema,
  email: emailSchema.optional(),
  code: confirmSignUpInputSchema.shape.code,
});
export const resendCodeSchema = z.object({
  locale: localeSchema.optional(),
  email: emailSchema.optional(),
});
export const signInSchema = signInInputSchema
  .omit({ client: true })
  .extend({ locale: localeSchema, next: z.string().max(2048).optional() });
export const signOutSchema = z.object({ locale: localeSchema });
export const createCompanySchema = z
  .object({
    locale: localeSchema,
    kind: companyKindSchema,
    idempotencyKey: idempotencyKeySchema.optional(),
    nameEn: companyNameSchema.shape.en,
    nameAr: companyNameSchema.shape.ar,
    tradeLicenceNumber: z.string().trim().min(1).max(40).optional(),
  })
  .refine(
    (input) =>
      input.kind !== "management_company" || Boolean(input.tradeLicenceNumber),
  );
export type SignUpRequest = z.infer<typeof signUpSchema>;
export type ConfirmSignUpRequest = z.infer<typeof confirmSignUpSchema>;
export type ResendCodeRequest = z.infer<typeof resendCodeSchema>;
export type SignInRequest = z.infer<typeof signInSchema>;
export type SignOutRequest = z.infer<typeof signOutSchema>;
export type CreateCompanyRequest = z.infer<typeof createCompanySchema>;

export const createInvitationSchema = z.object({
  locale: localeSchema,
  email: emailSchema,
  staffRoles: staffRolesSchema,
  inviteLocale: localeSchema,
  idempotencyKey: idempotencyKeySchema,
});
export const invitationLinkSchema = z.object({
  invitation: invitationSchema.pick({
    id: true,
    email: true,
    staffRoles: true,
    status: true,
    deliveryStatus: true,
    expiresAt: true,
  }),
  inviteUrl: z.url().nullable(),
});

export const companySettingsSchema = z.object({
  locale: localeSchema,
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: z.number().int().positive(),
  name: companyNameSchema,
  tradeLicenceNumber: z.string().trim().min(1).max(40).nullable(),
  trn: z
    .string()
    .trim()
    .regex(/^\d{15}$/)
    .nullable(),
});
