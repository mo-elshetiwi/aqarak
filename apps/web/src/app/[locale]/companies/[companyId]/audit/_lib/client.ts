import "server-only";
import type { CompanyContext } from "@/lib/api/contract";
import { workflowIsMock } from "../../tawtheeq/_lib/client";
import { createAuditHttpClient } from "./http-client";
import { createAuditMockClient } from "./mock-client";
import type {
  Anchor,
  AuditFilters,
  AuditResult,
  Events,
  SubjectType,
  Verification,
  Versions,
} from "./schemas";
export interface AuditClient {
  events(filters: AuditFilters): Promise<AuditResult<Events>>;
  versions(type: SubjectType, id: string): Promise<AuditResult<Versions>>;
  verify(key: string): Promise<AuditResult<Verification>>;
  anchor(key: string): Promise<AuditResult<Anchor>>;
  exportCsv(
    filters: AuditFilters,
  ): Promise<
    AuditResult<{ body: ReadableStream<Uint8Array>; disposition: string }>
  >;
}
export function canReadAudit(context: CompanyContext): boolean {
  return context.staffRoles.some(
    (role) => role === "manager" || role === "company_administrator",
  );
}
export function getAuditClient(
  companyId: string,
  sessionId: string,
): AuditClient {
  if (workflowIsMock()) return createAuditMockClient(companyId, sessionId);
  const value = process.env.AQARAK_API_BASE_URL;
  if (!value) throw new Error("Missing workflow API URL");
  const url = new URL(value);
  const local =
    ["localhost", "[::1]"].includes(url.hostname) ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid workflow API URL");
  return createAuditHttpClient(
    url.href.replace(/\/$/, ""),
    companyId,
    sessionId,
  );
}
