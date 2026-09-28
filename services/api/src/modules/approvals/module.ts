import { z } from "zod";
import type { ApiModule } from "../index";
import { json, type WorkflowRuntime } from "../contracts/runtime/request";
import { rows, integer, instant } from "../contracts/runtime/sql";
export function createApprovalsModule(runtime: WorkflowRuntime): ApiModule {
  return {
    name: "approvals",
    basePath: "/v1/companies/:companyId/approvals",
    register(app) {
      app.get(
        "/",
        runtime({
          command: "approvals_list",
          schema: z.strictObject({}),
          run: async (context) => {
            const pending = await rows(
              context.tx,
              `select a.id as approval_id,a.slot,a.subject_hash,a.created_at,c.id as contract_id,c.contract_no,v.version_no,u.unit_no,p.name_en,p.name_ar,pa.display_name as submitted_by
        from lease.approval a join lease.contract_version v on v.id=a.contract_version_id and v.company_id=a.company_id
        join lease.contract c on c.current_version_id=v.id and c.company_id=v.company_id
        join lease.contract_unit cu on cu.contract_id=c.id and cu.company_id=c.company_id
        join estate.unit u on u.id=cu.unit_id and u.company_id=cu.company_id
        join estate.property p on p.id=u.property_id and p.company_id=u.company_id
        left join lease.approval ma on ma.contract_version_id=v.id and ma.company_id=v.company_id and ma.slot='manager' and ma.status='approved'
        left join core.person_account pa on pa.id=ma.approver_account_id
        where a.status='requested' and a.approver_account_id=:account::uuid order by a.created_at,a.id`,
              { account: context.actor.accountId },
            );
            return json({
              items: pending.map((a) => ({
                approvalId: a.approval_id,
                slot: a.slot,
                contractId: a.contract_id,
                contractNo: a.contract_no,
                unit: {
                  unitNo: a.unit_no,
                  propertyName: { en: a.name_en ?? "", ar: a.name_ar ?? "" },
                },
                versionNo: integer(a, "version_no"),
                subjectHash: a.subject_hash,
                requestedAt: instant(a.created_at),
                submittedBy: a.submitted_by ?? "",
              })),
            });
          },
        }),
      );
    },
  };
}
