// I bundle the workspace domain source so the local server does not externalise extensionless TypeScript imports.
export {
  can,
  companyId,
  personAccountId,
  tenantId,
  ownerId,
  idempotencyKey,
  requestSha256,
  decideIdempotency,
  checkUploadRequest,
  sniffContentType,
} from "../../../../../packages/domain/src/index";
export type {
  CanonicalValue,
  PermissionActor,
  Role,
} from "../../../../../packages/domain/src/index";
