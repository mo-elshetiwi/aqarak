import type { Row } from "./runtime/db";
import type { WriteContext } from "./runtime/mutations";
import { insertBusiness, updateBusiness } from "./runtime/mutations";
import type { DraftInput } from "./schema";
import { string, nullableString } from "./runtime/sql";
export async function saveVersion(
  context: WriteContext,
  input: {
    contract: Row;
    draft: DraftInput;
    number: number;
    hash: string;
    eventType: string;
    unitLink: Row | null;
    tenant: Row;
  },
): Promise<string> {
  const d = input.draft;
  const versionId = await insertBusiness(context, {
    table: "lease.contract_version",
    eventType: input.eventType,
    values: {
      contract_id: string(input.contract, "id"),
      version_no: input.number,
      kind: "standard",
      term_start: d.termStart,
      term_end: d.termEnd,
      grace_days: d.graceDays,
      annual_rent_fils: d.annualRentFils,
      total_fils: d.totalFils,
      deposit_fils: d.depositFils,
      vat_bp: d.vatBp,
      template_code: "standard_residential",
      template_version: 1,
      content_hash: input.hash,
    },
  });
  for (const instalment of d.instalments) {
    const instalmentId = await insertBusiness(context, {
      table: "money.instalment",
      eventType: input.eventType,
      values: {
        contract_version_id: versionId,
        seq_no: instalment.seqNo,
        due_on: instalment.dueOn,
        amount_fils: instalment.amountFils,
        vat_fils: instalment.vatFils,
        status: "open",
      },
    });
    if (instalment.cheque)
      await insertBusiness(context, {
        table: "money.cheque",
        eventType: input.eventType,
        values: {
          instalment_id: instalmentId,
          cheque_no: instalment.cheque.chequeNo,
          bank_name: instalment.cheque.bankName,
          drawer_name:
            nullableString(input.tenant, "full_name_en") ??
            nullableString(input.tenant, "full_name_ar") ??
            "",
          cheque_date: instalment.dueOn,
          amount_fils: instalment.amountFils + instalment.vatFils,
          status: "pending",
        },
      });
  }
  for (const [index, clause] of d.specialClauses.entries())
    await insertBusiness(context, {
      table: "lease.contract_version_clause",
      eventType: input.eventType,
      values: {
        contract_version_id: versionId,
        position: index + 1,
        clause_key: `special_${String(index + 1)}`,
        source: "special",
        text_en: clause.textEn,
        text_ar: clause.textAr,
        model_translated: clause.modelTranslated,
      },
    });
  if (input.unitLink) {
    if (
      input.unitLink.occupancy_start !== d.termStart ||
      input.unitLink.occupancy_end !== d.termEnd
    )
      await updateBusiness(context, {
        table: "lease.contract_unit",
        row: input.unitLink,
        eventType: input.eventType,
        values: { occupancy_start: d.termStart, occupancy_end: d.termEnd },
      });
  } else
    await insertBusiness(context, {
      table: "lease.contract_unit",
      eventType: input.eventType,
      values: {
        contract_id: string(input.contract, "id"),
        unit_id: d.unitId,
        occupancy_start: d.termStart,
        occupancy_end: d.termEnd,
        blocks_unit: false,
      },
    });
  await updateBusiness(context, {
    table: "lease.contract",
    row: input.contract,
    eventType: input.eventType,
    values: { current_version_id: versionId },
  });
  return versionId;
}
