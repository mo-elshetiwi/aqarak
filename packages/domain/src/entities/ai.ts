import { z } from "zod";
import * as ids from "../ids";
import * as vocabulary from "../vocabulary";
import {
  jsonValue,
  sha256,
  standardFields,
  subjectId,
  subjectType,
  text,
} from "./shared";

/** Records model execution metadata and digests without retaining content. */
export const modelCallRecord = z.strictObject({
  ...standardFields(ids.modelCallId),
  purpose: text,
  registryEntry: text,
  promptVersion: text,
  inputSha256: sha256,
  outputSha256: sha256.nullable(),
  latencyMs: z.int().min(0),
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  costMicroUsd: z.int().min(0),
  status: z.enum(["succeeded", "failed", "schema_invalid"]),
});
/** Represents stored model execution metadata. */
export type ModelCallRecord = z.infer<typeof modelCallRecord>;

/** Records structured extracted values and bounded evidence from a document version. */
export const extractionRecord = z.strictObject({
  ...standardFields(ids.extractionId),
  documentVersionId: ids.documentVersionId,
  modelCallId: ids.modelCallId,
  schemaCode: text,
  fields: z.record(
    text,
    z.strictObject({
      value: jsonValue,
      confidence: z.number().min(0).max(1).nullable(),
      page: z.int().positive().nullable(),
      evidence: z.string().max(500).nullable(),
    }),
  ),
});
/** Represents stored document extraction fields. */
export type ExtractionRecord = z.infer<typeof extractionRecord>;

/** Records a proposed command with version checks and field provenance. */
export const draftedActionRecord = z
  .strictObject({
    ...standardFields(ids.draftedActionId),
    forAccountId: ids.personAccountId,
    initiator: vocabulary.initiator,
    channel: vocabulary.channel,
    commandType: text,
    payload: z.record(z.string(), jsonValue),
    baseVersions: z.record(subjectId, z.int().min(1)),
    fieldProvenance: z.record(text, vocabulary.fieldProvenance),
    extractionId: ids.extractionId.nullable(),
    status: vocabulary.draftedActionStatus,
    failureReason: text.nullable(),
  })
  .refine(
    (record) =>
      (record.status === "failed") === (record.failureReason !== null),
    {
      message: "A failure reason is required exactly when failed",
      path: ["failureReason"],
    },
  );
/** Represents a stored proposed command. */
export type DraftedActionRecord = z.infer<typeof draftedActionRecord>;

/** Records a subject version and snapshot digest within a transaction. */
export const entityVersionRecord = z.strictObject({
  ...standardFields(ids.entityVersionId),
  subjectType,
  subjectId,
  subjectVersion: z.int().min(1),
  snapshotSha256: sha256,
  txId: z.string().regex(/^[0-9]+$/),
});
/** Represents a stored subject version snapshot digest. */
export type EntityVersionRecord = z.infer<typeof entityVersionRecord>;
