import "server-only";
import type { CompanyContext } from "@/lib/api/contract";
import { isMockApi } from "@/lib/api";
import { createHttpClient } from "./http-client";
import { createMockClient } from "./mock-client";
import type {
  OwnerDecision,
  OwnerReapproval,
  DocumentUrl,
  Expected,
  Extraction,
  ReasonInput,
  RecordList,
  ResolutionsInput,
  ReviewInput,
  SkipInput,
  TawtheeqRecord,
  UploadInput,
  UploadResult,
  WorkflowResult,
} from "./schemas";

export interface TawtheeqClient {
  ownerReapproval(
    recordId: string,
    input: OwnerReapproval,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
  skipConfirmation(
    recordId: string,
    input: OwnerDecision,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
  listRecords(): Promise<WorkflowResult<RecordList>>;
  getRecord(recordId: string): Promise<WorkflowResult<TawtheeqRecord>>;
  getDocumentUrl(recordId: string): Promise<WorkflowResult<DocumentUrl>>;
  attestPortal(
    recordId: string,
    input: Expected,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
  requestUpload(
    recordId: string,
    input: UploadInput,
    key: string,
  ): Promise<WorkflowResult<UploadResult>>;
  completeUpload(
    recordId: string,
    documentId: string,
    input: Expected,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
  runExtraction(
    recordId: string,
    key: string,
  ): Promise<WorkflowResult<Extraction>>;
  submitReview(
    recordId: string,
    input: ReviewInput,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
  submitResolutions(
    recordId: string,
    input: ResolutionsInput,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
  portalReturn(
    recordId: string,
    input: ReasonInput,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
  skip(
    recordId: string,
    input: SkipInput,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
  resume(
    recordId: string,
    input: Expected,
    key: string,
  ): Promise<WorkflowResult<TawtheeqRecord>>;
}
export function workflowIsMock(): boolean {
  const mode = process.env.AQARAK_WORKFLOW_API_MODE;
  if (mode !== undefined && mode !== "mock" && mode !== "http")
    throw new Error("Invalid workflow API mode");
  return mode ? mode === "mock" : isMockApi();
}
export function getTawtheeqClient(
  companyId: string,
  sessionId: string,
  context?: CompanyContext,
): TawtheeqClient {
  if (workflowIsMock())
    return context
      ? createMockClient(companyId, sessionId, context)
      : createMockClient(companyId, sessionId);
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
  return createHttpClient(url.href.replace(/\/$/, ""), companyId, sessionId);
}
