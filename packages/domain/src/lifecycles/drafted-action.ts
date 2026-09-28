import { z } from "zod";
import { checkExpectedVersion, refuse, requireReason } from "../errors";
import {
  companyId,
  draftedActionId,
  personAccountId,
  type PersonAccountId,
} from "../ids";
import { ok, type Result } from "../result";
import {
  draftedActionStatus,
  fieldProvenance,
  type DraftedActionStatus,
  type Initiator,
} from "../vocabulary";
import type { LifecycleError } from "./errors";

/** Describes immutable command values that can be validated and attributed field by field. */
export type DraftedValue =
  | null
  | boolean
  | number
  | string
  | readonly DraftedValue[]
  | { readonly [key: string]: DraftedValue };
const draftedValue: z.ZodType<DraftedValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(draftedValue).readonly(),
    z.record(z.string(), draftedValue).readonly(),
  ]),
);
const payload = z.record(z.string(), draftedValue).readonly();
const versions = z.record(z.string(), z.int().nonnegative()).readonly();
const refusal = z
  .strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
    field: z.string().optional(),
  })
  .readonly();
/** Validates a drafted command; provenance uses JSON Pointer paths to each leaf or empty container. */
export const draftedAction = z
  .strictObject({
    id: draftedActionId,
    company_id: companyId,
    drafted_for_account_id: personAccountId,
    status: draftedActionStatus,
    version: z.int().nonnegative(),
    payload,
    field_provenance: z.record(z.string(), fieldProvenance).readonly(),
    base_versions: versions,
    refusal: refusal.nullable(),
    reason: z.string().nullable(),
  })
  .readonly();
/** Describes a drafted command with retained attribution and version evidence. */
export type DraftedAction = z.infer<typeof draftedAction>;
/** Describes validation, a person's commit decision, or a person's reasoned rejection. */
export type DraftedActionCommand =
  | { readonly type: "ready"; readonly schema: z.ZodType }
  | {
      readonly type: "commit";
      readonly current_versions: Readonly<Record<string, number>>;
      readonly command_result: Result<unknown>;
    }
  | { readonly type: "reject"; readonly reason?: string | null };
/** Defines allowed drafted-action transitions, including commit outcomes as data. */
export const draftedActionTransitions: Readonly<
  Record<
    DraftedActionStatus,
    Readonly<
      Partial<
        Record<DraftedActionCommand["type"], readonly DraftedActionStatus[]>
      >
    >
  >
> = {
  drafting: { ready: ["ready"] },
  ready: { commit: ["committed", "expired", "failed"], reject: ["rejected"] },
  committed: {},
  rejected: {},
  expired: {},
  failed: {},
};
/** Identifies the initiator and expected row version for a drafted-action transition. */
export interface DraftedActionContext {
  readonly initiator: Initiator;
  readonly account_id: PersonAccountId | null;
  readonly expected_version: number;
}

function pointerSegment(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function leafPaths(value: DraftedValue, path: string): readonly string[] {
  if (value === null || typeof value !== "object") return [path];
  const entries = Object.entries(value);
  if (entries.length === 0) return [path];
  return entries.flatMap(([key, child]: [string, DraftedValue]) =>
    leafPaths(child, `${path}/${pointerSegment(key)}`),
  );
}

function hasProvenance(current: DraftedAction): boolean {
  return Object.entries(current.payload)
    .flatMap(([key, value]) => leafPaths(value, `/${pointerSegment(key)}`))
    .every(
      (path) =>
        Object.hasOwn(current.field_provenance, path) &&
        fieldProvenance.safeParse(current.field_provenance[path]).success,
    );
}

function readyDraft(
  current: DraftedAction,
  schema: z.ZodType,
): Result<DraftedAction, LifecycleError> {
  const validated = schema.safeParse(current.payload);
  if (!validated.success) return refuse("INVALID_INPUT", "payload");
  const parsed = payload.safeParse(validated.data);
  if (!parsed.success) return refuse("INVALID_INPUT", "payload");
  return ok({
    ...current,
    payload: parsed.data,
    status: "ready",
    version: current.version + 1,
  });
}

function commitDraft(
  current: DraftedAction,
  command: Extract<DraftedActionCommand, { readonly type: "commit" }>,
): Result<DraftedAction, LifecycleError> {
  const next = { ...current, version: current.version + 1 };
  if (
    Object.entries(current.base_versions).some(
      ([key, version]) =>
        !Object.hasOwn(command.current_versions, key) ||
        command.current_versions[key] !== version,
    )
  )
    return ok({
      ...next,
      status: "expired",
      refusal: { code: "BASE_VERSION_CHANGED" },
    });
  if (!hasProvenance(current))
    return refuse("INVALID_INPUT", "field_provenance");
  if (!command.command_result.ok) {
    const parsed = refusal.safeParse(command.command_result.error);
    if (!parsed.success) return refuse("INVALID_INPUT", "command_result");
    return ok({ ...next, status: "failed", refusal: parsed.data });
  }
  return ok({ ...next, status: "committed" });
}

/** Applies a pure command decision; IN5 and IN7 require the drafted-for person for commit or rejection. */
export function transitionDraftedAction(
  current: DraftedAction,
  command: DraftedActionCommand,
  context: DraftedActionContext,
): Result<DraftedAction, LifecycleError> {
  if (draftedActionTransitions[current.status][command.type] === undefined)
    return refuse("INVALID_TRANSITION");
  const version = checkExpectedVersion(
    current.version,
    context.expected_version,
  );
  if (!version.ok) return version;
  if (command.type === "ready") return readyDraft(current, command.schema);
  if (context.initiator !== "person") return refuse("PERSON_REQUIRED");
  if (context.account_id !== current.drafted_for_account_id)
    return refuse("NOT_DRAFTED_FOR_ACTOR");
  switch (command.type) {
    case "commit":
      return commitDraft(current, command);
    case "reject": {
      const reason = requireReason(command.reason);
      if (!reason.ok) return reason;
      return ok({
        ...current,
        status: "rejected",
        version: current.version + 1,
        reason: reason.value,
      });
    }
  }
}
