"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { tenantPath } from "./routes";
import {
  parseCreateTenant,
  createTenantValuesSchema,
  type CreateTenantValues,
} from "./create-tenant";
import { revalidatePath } from "next/cache";
import { authorize, ownedVersion } from "./access";
import { getJ3Client } from "./j3";
import { panelDecisionSchema, recordInOrder } from "./record-decisions";
import {
  uploadInputSchema,
  rejectInputSchema,
  type Invitation,
  type Problem,
  type Outcome,
  type TenantDetail,
  type Upload,
  type VersionDetail,
} from "./j3-contract";

const commandSchema = z.object({
  locale: z.enum(["en", "ar"]),
  companyId: z.uuid(),
  tenantId: z.string().min(1),
  key: z.uuid(),
});
const versionCommandSchema = commandSchema.extend({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
});
export type CommandContext = z.infer<typeof commandSchema>;
export type VersionCommand = z.infer<typeof versionCommandSchema>;
export async function requestUploadAction(
  input: unknown,
): Promise<Outcome<Upload>> {
  const parsed = commandSchema
    .extend({ upload: uploadInputSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  const args = parsed.data;
  const auth = await authorize(args.locale, args.companyId);
  if (!auth.ok) return auth;
  if (args.upload.subjectId !== args.tenantId)
    return { ok: false, code: "NOT_FOUND" };
  const client = getJ3Client();
  const tenant = await client.getTenant(auth.access, args.tenantId);
  if (!tenant.ok) return tenant;
  return client.requestUpload(auth.access, args.upload, args.key);
}
async function runVersion(
  input: unknown,
  operation: "completeUpload" | "startExtraction",
): Promise<Outcome<{ version: VersionDetail }>> {
  const parsed = versionCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  const args = parsed.data;
  const auth = await authorize(args.locale, args.companyId);
  if (!auth.ok) return auth;
  const client = getJ3Client();
  const owned = await ownedVersion(client, auth.access, args.tenantId, args);
  if (!owned.ok) return owned;
  return client[operation](auth.access, args, args.key);
}
export async function completeUploadAction(
  input: unknown,
): Promise<Outcome<{ version: VersionDetail }>> {
  return runVersion(input, "completeUpload");
}
export async function startExtractionAction(
  input: unknown,
): Promise<Outcome<{ version: VersionDetail }>> {
  return runVersion(input, "startExtraction");
}
export async function recordDecisionsAction(
  input: unknown,
): Promise<Outcome<{ recorded: number }>> {
  const parsed = versionCommandSchema
    .extend({ decisions: z.record(z.string(), panelDecisionSchema) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  const args = parsed.data;
  const auth = await authorize(args.locale, args.companyId);
  if (!auth.ok) return auth;
  const client = getJ3Client();
  const owned = await ownedVersion(client, auth.access, args.tenantId, args);
  if (!owned.ok) return owned;
  const result = await client.getVersion(auth.access, args);
  if (!result.ok) return result;
  return recordInOrder(client, auth.access, args, {
    version: result.version,
    decisions: args.decisions,
    key: args.key,
  });
}
export async function saveIdentityAction(
  input: unknown,
): Promise<Outcome<{ tenant: TenantDetail; version: VersionDetail }>> {
  const parsed = versionCommandSchema
    .extend({ expectedTenantVersion: z.number().int().positive() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  const args = parsed.data;
  const auth = await authorize(args.locale, args.companyId);
  if (!auth.ok) return auth;
  const client = getJ3Client();
  const owned = await ownedVersion(client, auth.access, args.tenantId, args);
  if (!owned.ok) return owned;
  const result = await client.saveIdentity(
    auth.access,
    args.tenantId,
    {
      documentVersionId: args.versionId,
      expectedTenantVersion: args.expectedTenantVersion,
    },
    args.key,
  );
  if (result.ok)
    revalidatePath(
      `/${args.locale}/companies/${args.companyId}/tenants`,
      "layout",
    );
  return result;
}

export async function createTenantAction(
  input: unknown,
): Promise<{ ok: false } & Problem & { values: CreateTenantValues }> {
  const context = commandSchema
    .omit({ tenantId: true })
    .extend({ values: createTenantValuesSchema })
    .safeParse(input);
  if (!context.success)
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      values: {
        fullNameEn: "",
        fullNameAr: "",
        email: "",
        phoneE164: "",
        preferredLanguage: "en",
      },
    };
  const values = context.data.values;
  const parsed = parseCreateTenant(values);
  if (!parsed.success)
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      values,
      fields: parsed.error.issues.map((issue) => String(issue.path[0])),
    };
  const args = context.data;
  const auth = await authorize(args.locale, args.companyId);
  if (!auth.ok) return { ...auth, values };
  const result = await getJ3Client().createTenant(
    auth.access,
    parsed.data,
    args.key,
  );
  if (!result.ok) return { ...result, values };
  revalidatePath(
    `/${args.locale}/companies/${args.companyId}/tenants`,
    "layout",
  );
  redirect(tenantPath({ ...args, tenantId: result.tenant.id }));
}
export async function inviteTenantAction(
  input: unknown,
): Promise<Outcome<{ invitation: Invitation }>> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  const args = parsed.data;
  const auth = await authorize(args.locale, args.companyId);
  if (!auth.ok) return auth;
  const result = await getJ3Client().inviteTenant(
    auth.access,
    args.tenantId,
    args.key,
  );
  if (result.ok) revalidatePath(tenantPath(args));
  return result;
}
export async function rejectUploadAction(
  input: unknown,
): Promise<Outcome<{ version: VersionDetail }>> {
  const parsed = versionCommandSchema
    .extend({ rejection: rejectInputSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  const args = parsed.data;
  const auth = await authorize(args.locale, args.companyId);
  if (!auth.ok) return auth;
  const client = getJ3Client();
  const owned = await ownedVersion(client, auth.access, args.tenantId, args);
  if (!owned.ok) return owned;
  const result = await client.rejectVersion(
    auth.access,
    args,
    args.rejection,
    args.key,
  );
  if (!result.ok) return result;
  revalidatePath(
    `/${args.locale}/companies/${args.companyId}/tenants`,
    "layout",
  );
  redirect(tenantPath(args));
}
