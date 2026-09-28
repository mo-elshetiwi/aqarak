import {
  effectiveTicketPriority,
  transitionTicket,
  ticketTransitions,
  personAccountId,
  ticketId,
  utcInstant,
  nonNegativeFils,
  type MaintenanceActor,
} from "@aqarak/domain";
import { z } from "zod";
import { confirmIntakeBodySchema } from "./contract";
import type { DraftRow } from "./intake-records";
import { Denied } from "./problem";

export type ConfirmBody = z.infer<typeof confirmIntakeBodySchema>;
export function fieldProvenance(
  draft: DraftRow["payload"],
  confirmed: ConfirmBody,
): Record<string, "ai_confirmed" | "ai_edited" | "human_entered"> {
  const result: Record<string, "ai_confirmed" | "ai_edited" | "human_entered"> =
    {};
  for (const [path, field] of [
    ["/transcript", "transcript"],
    ["/category", "category"],
    ["/priority", "priority"],
    ["/safety_flags", "safetyFlags"],
    ["/description", "description"],
  ] as const) {
    const model =
      field === "transcript"
        ? draft.transcriptionMode === "model" && draft.transcript !== null
        : draft.triageMode === "model";
    const equal =
      field === "safetyFlags"
        ? [...new Set(draft.safetyFlags)].sort().join(",") ===
          [...new Set(confirmed.safetyFlags)].sort().join(",")
        : draft[field] === confirmed[field];
    result[path] = model
      ? equal
        ? "ai_confirmed"
        : "ai_edited"
      : "human_entered";
  }
  return result;
}
export function reportDecision(input: {
  id: string;
  actorId: string;
  authorId: string;
  role: MaintenanceActor["role"];
  ownerAccountId: string | null;
  payer: "owner" | "tenant";
  confirmed: ConfirmBody;
}): {
  status: "reported";
  priority: ConfirmBody["priority"];
  safetyCritical: boolean;
} {
  const { confirmed } = input;
  const priority = effectiveTicketPriority(
    confirmed.priority,
    confirmed.safetyFlags,
  );
  if (
    !ticketTransitions.some(
      (row) =>
        row.from === null && row.command === "report" && row.to === "reported",
    ) ||
    !["tenant", "owner", "technician", "manager"].includes(input.role) ||
    input.actorId !== input.authorId
  )
    throw new Denied("drafted_action", input.id, 403, "NOT_AUTHORISED");
  if (input.ownerAccountId !== null) {
    const account = personAccountId.parse(input.actorId);
    const now = utcInstant.parse(new Date().toISOString());
    const result = transitionTicket(
      null,
      {
        type: "report",
        confirmed: true,
        report: {
          id: ticketId.parse(input.id),
          authorAccountId: personAccountId.parse(input.authorId),
          authorRole: input.role,
          ownerAccountId: personAccountId.parse(input.ownerAccountId),
          reportedAt: now,
          category: confirmed.category,
          priority: confirmed.priority,
          payer: input.payer,
          safetyFlags: confirmed.safetyFlags,
          linked_ticket_id: null,
        },
      },
      {
        actor: {
          role: input.role,
          accountId: account,
          sessionAccountId: account,
        },
        now,
        confirmationDeadline: now,
        ownerApproval: null,
        cost: {
          costFils: nonNegativeFils.parse(0),
          costThresholdFils: null,
          emergencyLimitFils: null,
          ownerContactAttempts: 0,
          ownerReachable: false,
        },
      },
    );
    if (!result.ok)
      throw new Denied("drafted_action", input.id, 403, "NOT_AUTHORISED");
    return {
      status: "reported",
      priority: result.value.ticket.priority,
      safetyCritical: confirmed.safetyFlags.length > 0,
    };
  }
  return {
    status: "reported",
    priority,
    safetyCritical: confirmed.safetyFlags.length > 0,
  };
}
