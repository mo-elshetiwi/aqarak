import { z } from "zod";
import { isLocale } from "@aqarak/i18n";
import type { Result } from "@aqarak/domain";

export const localeSchema = z.enum(["en", "ar"]).refine(isLocale);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
export const staffRoleSchema = z.enum([
  "manager",
  "technician",
  "company_administrator",
  "accountant",
]);
export const companyKindSchema = z.enum([
  "management_company",
  "self_managed_owner",
]);
export const companyNameSchema = z.object({
  en: z.string().trim().min(2).max(120),
  ar: z.string().trim().min(2).max(120),
});
export const accountSchema = z.object({
  id: z.guid(),
  email: emailSchema,
  displayName: z.string().min(1),
  locale: localeSchema,
});
export const companyContextSchema = z
  .object({
    companyId: z.uuid(),
    companyName: companyNameSchema,
    companyKind: companyKindSchema,
    isDemo: z.boolean(),
    staffRoles: z
      .array(staffRoleSchema)
      .refine((roles) => new Set(roles).size === roles.length),
    partyLinks: z.array(
      z.object({ role: z.enum(["owner", "tenant"]), partyId: z.uuid() }),
    ),
  })
  .refine(
    (context) => context.staffRoles.length + context.partyLinks.length > 0,
  );
export const meSchema = z.object({
  account: accountSchema,
  contexts: z.array(companyContextSchema),
});
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const sessionGrantSchema = z.object({
  session: z
    .object({
      id: sessionIdSchema,
      expiresAt: z.iso.datetime(),
      idleExpiresAt: z.iso.datetime(),
    })
    .refine(
      (session) =>
        Date.parse(session.idleExpiresAt) <= Date.parse(session.expiresAt),
    ),
});
export const passwordPolicySchema = z
  .string()
  .min(12)
  .max(256)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/\d/)
  .regex(/[^A-Za-z0-9]/);
export const signUpInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  fullName: z.string().trim().min(2).max(120),
  locale: localeSchema,
});
export const signUpAcceptedSchema = z.object({
  accountId: z.guid(),
  delivery: z.object({
    medium: z.literal("email"),
    destination: z.string().regex(/^[^@]\*{3}@[^@\s]+$/),
  }),
});
export const confirmSignUpInputSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
});
export const resendCodeInputSchema = z.object({ email: emailSchema });
export const signInInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  client: z.literal("web"),
});
export const createCompanyInputSchema = z
  .object({
    kind: companyKindSchema,
    name: companyNameSchema,
    tradeLicenceNumber: z.string().trim().min(1).max(40).optional(),
  })
  .refine(
    (input) =>
      input.kind !== "management_company" || Boolean(input.tradeLicenceNumber),
  );
export const companyCreatedSchema = z
  .object({
    company: z.object({
      id: z.uuid(),
      kind: companyKindSchema,
      name: companyNameSchema,
      isDemo: z.literal(false),
    }),
    context: companyContextSchema,
  })
  .refine(
    ({ company, context }) =>
      company.id === context.companyId &&
      company.kind === context.companyKind &&
      !context.isDemo &&
      company.name.en === context.companyName.en &&
      company.name.ar === context.companyName.ar,
  );
export const idempotencyKeySchema = z.uuid();
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const tokenInputSchema = z.object({ token: invitationTokenSchema });
export const staffRolesSchema = z
  .array(staffRoleSchema)
  .min(1)
  .max(4)
  .refine((roles) => new Set(roles).size === roles.length);
export const createInvitationInputSchema = z.object({
  kind: z.literal("staff"),
  email: emailSchema,
  staffRoles: staffRolesSchema,
  locale: localeSchema,
});
export const membershipSchema = z.object({
  membershipId: z.uuid(),
  accountId: z.guid(),
  email: emailSchema.nullable(),
  displayName: z.string().nullable(),
  staffRoles: z.array(staffRoleSchema),
  status: z.enum(["invited", "active", "suspended", "removed"]),
  version: z.number().int().positive(),
});
export const membersSchema = z.object({ members: z.array(membershipSchema) });
export const invitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "expired",
  "revoked",
]);
export const invitationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["staff", "owner", "tenant"]),
  email: emailSchema,
  staffRoles: z.array(staffRoleSchema),
  targetId: z.uuid().nullable(),
  status: invitationStatusSchema,
  expiresAt: z.iso.datetime(),
  deliveryStatus: z.enum(["not_configured", "sent", "failed"]),
  createdAt: z.iso.datetime(),
  version: z.number().int().positive(),
});
export const invitationsSchema = z.object({
  invitations: z.array(invitationSchema),
});
export const invitationCreatedSchema = z
  .object({
    invitation: invitationSchema,
    token: invitationTokenSchema.nullable(),
    acceptPath: z
      .string()
      .regex(/^\/(en|ar)\/invitation#[A-Za-z0-9_-]{43}$/)
      .nullable(),
  })
  .refine((value) =>
    value.token === null
      ? value.acceptPath === null
      : value.acceptPath?.endsWith(`#${value.token}`),
  );
export const invitationPreviewSchema = z.object({
  invitation: z.object({
    companyName: companyNameSchema,
    companyKind: companyKindSchema,
    kind: z.enum(["staff", "owner", "tenant"]),
    staffRoles: z.array(staffRoleSchema),
    maskedEmail: z.string().regex(/^[^@]\*{3}@[^@\s]+$/),
    expiresAt: z.iso.datetime(),
    status: invitationStatusSchema,
  }),
});
export const invitationAcceptedSchema = z.object({
  context: companyContextSchema,
});
export type Membership = z.infer<typeof membershipSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export type InvitationCreated = z.infer<typeof invitationCreatedSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;
export const apiProblemCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "EMAIL_TAKEN",
  "PASSWORD_POLICY",
  "RATE_LIMITED",
  "CODE_MISMATCH",
  "CODE_EXPIRED",
  "INVALID_CREDENTIALS",
  "USER_NOT_CONFIRMED",
  "SESSION_INVALID",
  "FORBIDDEN",
  "NOT_FOUND",
  "UNAVAILABLE",
  "VERSION_CONFLICT",
  "LAST_ADMINISTRATOR",
  "ACTIVE_MEMBERSHIP_ELSEWHERE",
  "INVITATION_NOT_PENDING",
  "INVITATION_EXISTS",
  "PARTY_ALREADY_LINKED",
  "IDEMPOTENCY_KEY_REUSED",
  "INVITATION_EMAIL_MISMATCH",
]);
export const apiProblemSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  code: apiProblemCodeSchema,
});
export type Account = z.infer<typeof accountSchema>;
export type StaffRole = z.infer<typeof staffRoleSchema>;
export type CompanyKind = z.infer<typeof companyKindSchema>;
export type CompanyContext = z.infer<typeof companyContextSchema>;
export type Me = z.infer<typeof meSchema>;
export type SessionGrant = z.infer<typeof sessionGrantSchema>;
export type SignUpInput = z.infer<typeof signUpInputSchema>;
export type SignUpAccepted = z.infer<typeof signUpAcceptedSchema>;
export type ConfirmSignUpInput = z.infer<typeof confirmSignUpInputSchema>;
export type ResendCodeInput = z.infer<typeof resendCodeInputSchema>;
export type SignInInput = z.infer<typeof signInInputSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanyInputSchema>;
export type CompanyCreated = z.infer<typeof companyCreatedSchema>;
export type ApiProblemCode = z.infer<typeof apiProblemCodeSchema>;
export interface ApiProblem {
  status: number;
  code: ApiProblemCode;
}
export const versionCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export const reasonCommandSchema = versionCommandSchema.extend({
  reason: z.string().trim().min(1).max(2000),
});
export const rolesCommandSchema = versionCommandSchema.extend({
  staffRoles: staffRolesSchema,
});
export const reactivateCommandSchema = versionCommandSchema.extend({
  reason: reasonCommandSchema.shape.reason.optional(),
});
export const memberChangedSchema = z.object({ member: membershipSchema });
export const invitationChangedSchema = z.object({
  invitation: invitationSchema,
});
export const companySchema = z.object({
  id: z.uuid(),
  kind: companyKindSchema,
  name: companyNameSchema,
  tradeLicenceNumber: z.string().nullable(),
  trn: z.string().nullable(),
  defaultOwnerGate: z.boolean(),
  isDemo: z.boolean(),
  status: z.enum(["active", "suspended"]),
  version: z.number().int().positive(),
});
export const companyResponseSchema = z.object({ company: companySchema });
export const updateCompanyInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: companyNameSchema.optional(),
    tradeLicenceNumber: z.string().trim().min(1).max(40).nullable().optional(),
    trn: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.tradeLicenceNumber !== undefined ||
      value.trn !== undefined,
  );
export type Company = z.infer<typeof companySchema>;
export type VersionCommand = z.infer<typeof versionCommandSchema>;
export type ReasonCommand = z.infer<typeof reasonCommandSchema>;
export type RolesCommand = z.infer<typeof rolesCommandSchema>;
export type ReactivateCommand = z.infer<typeof reactivateCommandSchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanyInputSchema>;
export interface AqarakApi {
  changeMemberRoles(
    sessionId: string,
    companyId: string,
    targetId: string,
    input: RolesCommand,
    idempotencyKey: string,
  ): Promise<Result<z.infer<typeof memberChangedSchema>, ApiProblem>>;
  suspendMember(
    sessionId: string,
    companyId: string,
    targetId: string,
    input: ReasonCommand,
    idempotencyKey: string,
  ): Promise<Result<z.infer<typeof memberChangedSchema>, ApiProblem>>;
  reactivateMember(
    sessionId: string,
    companyId: string,
    targetId: string,
    input: ReactivateCommand,
    idempotencyKey: string,
  ): Promise<Result<z.infer<typeof memberChangedSchema>, ApiProblem>>;
  removeMember(
    sessionId: string,
    companyId: string,
    targetId: string,
    input: ReasonCommand,
    idempotencyKey: string,
  ): Promise<Result<z.infer<typeof memberChangedSchema>, ApiProblem>>;
  revokeInvitation(
    sessionId: string,
    companyId: string,
    targetId: string,
    input: ReasonCommand,
    idempotencyKey: string,
  ): Promise<Result<z.infer<typeof invitationChangedSchema>, ApiProblem>>;
  resendInvitation(
    sessionId: string,
    companyId: string,
    targetId: string,
    input: VersionCommand,
    idempotencyKey: string,
  ): Promise<Result<z.infer<typeof invitationCreatedSchema>, ApiProblem>>;
  getCompany(
    sessionId: string,
    companyId: string,
  ): Promise<Result<{ company: Company }, ApiProblem>>;
  updateCompany(
    sessionId: string,
    companyId: string,
    input: UpdateCompanyInput,
    idempotencyKey: string,
  ): Promise<Result<{ company: Company }, ApiProblem>>;

  previewInvitation(
    token: string,
  ): Promise<Result<InvitationPreview, ApiProblem>>;
  acceptInvitation(
    sessionId: string,
    token: string,
    idempotencyKey: string,
  ): Promise<Result<z.infer<typeof invitationAcceptedSchema>, ApiProblem>>;
  listMembers(
    sessionId: string,
    companyId: string,
  ): Promise<Result<z.infer<typeof membersSchema>, ApiProblem>>;
  listInvitations(
    sessionId: string,
    companyId: string,
  ): Promise<Result<z.infer<typeof invitationsSchema>, ApiProblem>>;
  createInvitation(
    sessionId: string,
    companyId: string,
    input: CreateInvitationInput,
    idempotencyKey: string,
  ): Promise<Result<InvitationCreated, ApiProblem>>;
  signUp(input: SignUpInput): Promise<Result<SignUpAccepted, ApiProblem>>;
  confirmSignUp(input: ConfirmSignUpInput): Promise<Result<null, ApiProblem>>;
  resendCode(input: ResendCodeInput): Promise<Result<null, ApiProblem>>;
  signIn(input: SignInInput): Promise<Result<SessionGrant, ApiProblem>>;
  signOut(sessionId: string): Promise<Result<null, ApiProblem>>;
  getMe(sessionId: string): Promise<Result<Me, ApiProblem>>;
  createCompany(
    sessionId: string,
    input: CreateCompanyInput,
    idempotencyKey?: string,
  ): Promise<Result<CompanyCreated, ApiProblem>>;
}
