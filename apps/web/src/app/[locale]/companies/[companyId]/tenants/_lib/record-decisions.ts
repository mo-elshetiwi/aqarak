import { createHash } from "node:crypto";
import { z } from "zod";
import {
  fieldCatalogue,
  type Access,
  type J3Client,
  type Outcome,
  type VersionDetail,
  type VersionRef,
  type FieldDecision,
} from "./j3-contract";
export const panelDecisionSchema = z.object({
  status: z.enum(["accepted", "edited", "not_on_document", "undecided"]),
  value: z.string().nullable(),
  sourceViewed: z.boolean(),
});
export type PanelDecisions = Record<
  string,
  z.infer<typeof panelDecisionSchema>
>;
function fieldKey(key: string, name: string): string {
  const hex = createHash("sha256").update(`${key}:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function recordInOrder(
  client: J3Client,
  access: Access,
  ref: VersionRef,
  command: { version: VersionDetail; decisions: PanelDecisions; key: string },
): Promise<Outcome<{ recorded: number }>> {
  let recorded = 0;
  for (const field of fieldCatalogue) {
    const decision = command.decisions[field.name];
    if (!decision || decision.status === "undecided")
      return { ok: false, code: "FIELD_REQUIRED", field: field.name };
    const prior = command.version.decisions.find(
      (item) => item.fieldName === field.name,
    );
    if (alreadyRecorded(command.version, field.name, decision, prior)) {
      recorded += 1;
      continue;
    }
    const result = await client.recordField(
      access,
      { ...ref, fieldName: field.name },
      {
        decision: decision.status,
        ...(decision.status === "edited" && decision.value !== null
          ? { value: decision.value }
          : {}),
        sourceViewed: decision.sourceViewed,
        expectedVersion: prior?.version ?? null,
      },
      fieldKey(command.key, field.name),
    );
    if (!result.ok) return { ...result, field: result.field ?? field.name };
    recorded += 1;
  }
  return { ok: true, recorded };
}

function alreadyRecorded(
  version: VersionDetail,
  name: string,
  decision: PanelDecisions[string],
  prior: FieldDecision | undefined,
): boolean {
  const value =
    decision.status === "accepted"
      ? (version.fields?.find((field) => field.name === name)?.suggestedValue ??
        null)
      : decision.status === "edited"
        ? decision.value
        : null;
  return (
    prior?.decision === decision.status &&
    prior.value === value &&
    prior.sourceViewed === decision.sourceViewed
  );
}
