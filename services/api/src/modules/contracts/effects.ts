import {
  sha256Hex,
  encodeCanonical,
  type ContractEffect,
} from "./runtime/domain";
import type { Row } from "./runtime/db";
import type { WriteContext } from "./runtime/mutations";
import { insertBusiness, updateBusiness } from "./runtime/mutations";
import { first, rows, string } from "./runtime/sql";
import { deviceSummary } from "./runtime/auth";
import { insertNotifications } from "../notifications/writer";
import { renderContract } from "./render";
import type { RequestContext } from "./runtime/request";
import type { LoadedContract } from "./repository";
import { WorkflowProblem } from "./runtime/problem";
export interface EffectContext {
  write: WriteContext;
  request: RequestContext;
  loaded: LoadedContract;
  contractEvent: string;
  approvalEvent: string;
  versionId: string;
}
export async function applyApproval(
  context: EffectContext,
  effect: Extract<
    ContractEffect,
    { type: "record_approval" | "request_approval" }
  >,
): Promise<void> {
  const decided = effect.type === "record_approval";
  const slot = decided ? effect.approval.slot : effect.slot;
  const account = decided
    ? effect.approval.approverAccountId
    : effect.accountId;
  const hash = decided ? effect.approval.subjectHash : effect.subjectHash;
  const existing = await first(
    context.write.tx,
    "select * from lease.approval where contract_version_id=:id::uuid and slot=:slot and status='requested'",
    { id: context.versionId, slot },
  );
  let id: string;
  if (decided && existing) {
    if (existing.approver_account_id !== account)
      throw new WorkflowProblem("FORBIDDEN");
    await updateBusiness(context.write, {
      table: "lease.approval",
      row: existing,
      values: { status: "approved" },
      eventType: context.approvalEvent,
    });
    id = string(existing, "id");
  } else
    id = await insertBusiness(context.write, {
      table: "lease.approval",
      eventType: decided ? context.approvalEvent : context.contractEvent,
      values: {
        contract_version_id: context.versionId,
        slot,
        kind: "contract_approval",
        approver_account_id: account,
        subject_hash: hash,
        status: decided ? "approved" : "requested",
      },
    });
  if (decided)
    await insertBusiness(context.write, {
      table: "lease.approval_context",
      eventType: context.approvalEvent,
      values: {
        approval_id: id,
        channel: context.request.audit.channel,
        device: deviceSummary(context.request.request),
      },
    });
}
export async function freezeVersion(
  context: EffectContext,
  effect: Extract<ContractEffect, { type: "freeze_version" }>,
): Promise<void> {
  const template = await first(
    context.write.tx,
    "select * from lease.contract_template where company_id is null and code='standard_residential' and template_version=1",
  );
  if (!template) throw new WorkflowProblem("UNAVAILABLE");
  const rendered = renderContract({
    template,
    company: context.request.company,
    parties: context.loaded.parties,
    draft: context.loaded.draft,
    contractNo: string(context.loaded.contract, "contract_no"),
  });
  await updateBusiness(context.write, {
    table: "lease.contract_version",
    row: context.loaded.version,
    eventType: context.contractEvent,
    values: {
      submitted_at: context.request.dependencies.clock().toISOString(),
      frozen_owner_gate: effect.frozenOwnerGate,
      rendered_body_sha256: sha256Hex(
        encodeCanonical({
          en: rendered.en.sections
            .map((s) => `${String(s.number)}. ${s.heading}\n${s.body}`)
            .join("\n\n"),
          ar: rendered.ar.sections
            .map((s) => `${String(s.number)}. ${s.heading}\n${s.body}`)
            .join("\n\n"),
        }),
      ),
    },
  });
}
export async function voidApprovals(context: EffectContext): Promise<void> {
  const approvals = await rows(
    context.write.tx,
    "select * from lease.approval where contract_version_id=:id::uuid and status in ('requested','approved')",
    { id: context.versionId },
  );
  for (const approval of approvals) {
    if (
      approval.status === "requested" &&
      approval.slot === context.request.audit.role &&
      approval.approver_account_id === context.request.actor.accountId
    ) {
      await insertBusiness(context.write, {
        table: "lease.approval_context",
        eventType: "approval.voided",
        values: {
          approval_id: string(approval, "id"),
          channel: context.request.audit.channel,
          device: deviceSummary(context.request.request),
        },
      });
    }
    await updateBusiness(context.write, {
      table: "lease.approval",
      row: approval,
      eventType: "approval.voided",
      values: { status: "voided", reason: "contract_cancelled" },
    });
  }
}
async function recipient(
  context: EffectContext,
  slot: string,
): Promise<string | null> {
  if (slot === "tenant")
    return typeof context.loaded.parties.tenant.linked_account_id === "string"
      ? context.loaded.parties.tenant.linked_account_id
      : null;
  if (slot === "owner")
    return typeof context.loaded.parties.owner?.linked_account_id === "string"
      ? context.loaded.parties.owner.linked_account_id
      : null;
  const manager = await first(
    context.write.tx,
    "select approver_account_id from lease.approval where contract_version_id=:id::uuid and slot='manager' order by created_at limit 1",
    { id: context.versionId },
  );
  return manager ? string(manager, "approver_account_id") : null;
}
export async function notify(
  context: EffectContext,
  effect: { recipient: string; template: string; accountId?: string },
): Promise<void> {
  const accountId =
    effect.accountId ?? (await recipient(context, effect.recipient));
  if (!accountId) throw new WorkflowProblem("UNAVAILABLE");
  const approval =
    effect.template === "contract_approval_requested"
      ? await first(
          context.write.tx,
          "select id from lease.approval where contract_version_id=:id::uuid and slot=:slot and status='requested'",
          { id: context.versionId, slot: effect.recipient },
        )
      : undefined;
  const contractId = string(context.loaded.contract, "id");
  const inserted = await insertNotifications(context.write.tx, {
    companyId: context.write.companyId,
    actorAccountId: context.write.accountId,
    recipientAccountId: accountId,
    templateCode: effect.template,
    contractId,
    dedupeSubjectId: approval ? string(approval, "id") : contractId,
    eventType: context.contractEvent,
  });
  context.write.mutations.push(...inserted.mutations);
}
export async function applyExistingEffect(
  context: EffectContext,
  effect: ContractEffect,
): Promise<void> {
  switch (effect.type) {
    case "freeze_version":
      return freezeVersion(context, effect);
    case "record_approval":
    case "request_approval":
      return applyApproval(context, effect);
    case "void_live_approvals":
      return voidApprovals(context);
    case "set_blocks_unit":
      return updateBusiness(context.write, {
        table: "lease.contract_unit",
        row: context.loaded.unitLink,
        eventType: context.contractEvent,
        values: { blocks_unit: effect.value },
      });
    case "set_cancel_kind":
      return updateBusiness(context.write, {
        table: "lease.contract",
        row: context.loaded.contract,
        eventType: context.contractEvent,
        values: {
          status: "cancelled",
          cancel_kind: effect.cancelKind,
          cancel_reason: effect.reason,
        },
      });
    case "create_tawtheeq_record":
      await insertBusiness(context.write, {
        table: "lease.tawtheeq_record",
        eventType: "tawtheeq_record.awaiting_registration",
        values: {
          contract_id: string(context.loaded.contract, "id"),
          path: effect.path,
          workflow_state: effect.state,
          portal_status: "not_started",
        },
      });
      return;
    case "notify":
      return notify(context, effect);
    case "activate_schedule":
      return;
    case "create_contract":
    case "create_version":
    case "link_revision":
      return;
    case "record_retroactive_confirmation":
    case "record_end":
      throw new WorkflowProblem("INVALID_TRANSITION");
  }
}
export function rowIdentity(id: string): Row {
  return { id, version: 1 };
}
