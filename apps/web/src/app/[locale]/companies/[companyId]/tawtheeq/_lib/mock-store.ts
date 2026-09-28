import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { TawtheeqRecord, UploadInput, WorkflowResult } from "./schemas";
import { seedRecords } from "./fixtures";
export interface MockObject {
  id: string;
  recordId: string;
  sessionId: string;
  token: string;
  expires: number;
  input: UploadInput;
  bytes: Uint8Array | null;
  rejected: boolean;
  completionAttempts: number;
}
interface MockStore {
  records: Map<string, TawtheeqRecord>;
  objects: Map<string, MockObject>;
  replays: Map<
    string,
    { fingerprint: string; result: WorkflowResult<unknown> }
  >;
}
const scope = globalThis as typeof globalThis & {
  tawtheeqSyntheticStores?: Map<string, MockStore>;
  tawtheeqOwnerDecisions?: Map<
    string,
    { sessionId: string; record: TawtheeqRecord; skipApproved: boolean }
  >;
};
export function mockStore(sessionId = "unit-test"): MockStore {
  scope.tawtheeqSyntheticStores ??= new Map();
  let store = scope.tawtheeqSyntheticStores.get(sessionId);
  if (!store) {
    store = {
      records: new Map(seedRecords().map((r) => [r.id, r])),
      objects: new Map(),
      replays: new Map(),
    };
    scope.tawtheeqSyntheticStores.set(sessionId, store);
  }
  return store;
}
export function resetSyntheticStore(): void {
  delete scope.tawtheeqSyntheticStores;
  delete scope.tawtheeqOwnerDecisions;
}
export function mockObjectUrl(companyId: string, object: MockObject): string {
  return `/en/companies/${companyId}/tawtheeq/mock-storage/${object.id}?token=${object.token}`;
}
export function reserveObject(
  recordId: string,
  sessionId: string,
  input: UploadInput,
): MockObject {
  const object: MockObject = {
    id: randomUUID(),
    recordId,
    sessionId,
    token: randomUUID(),
    expires: Date.now() + 300_000,
    input,
    bytes: null,
    rejected: false,
    completionAttempts: 0,
  };
  mockStore(sessionId).objects.set(object.id, object);
  return object;
}
export function acceptObject(object: MockObject, bytes: Uint8Array): boolean {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== object.input.sha256 || bytes.length !== object.input.byteSize)
    return false;
  const prefix = Buffer.from(bytes.subarray(0, 4)).toString("hex");
  object.rejected =
    object.input.contentType === "image/png"
      ? prefix !== "89504e47"
      : object.input.contentType === "image/jpeg"
        ? !prefix.startsWith("ffd8ff")
        : prefix !== "25504446";
  object.bytes = bytes;
  return true;
}

export function pendingOwnerRecord(
  id: string,
):
  | { sessionId: string; record: TawtheeqRecord; skipApproved: boolean }
  | undefined {
  return scope.tawtheeqOwnerDecisions?.get(id);
}
export function publishOwnerRecord(
  sessionId: string,
  record: TawtheeqRecord,
): void {
  scope.tawtheeqOwnerDecisions ??= new Map();
  const previous = scope.tawtheeqOwnerDecisions.get(record.id);
  scope.tawtheeqOwnerDecisions.set(record.id, {
    sessionId,
    record: structuredClone(record),
    skipApproved: previous?.sessionId === sessionId && previous.skipApproved,
  });
}
