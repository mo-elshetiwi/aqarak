import { z } from "zod";
import { err, ok } from "@aqarak/domain";
import type { NextRequest, NextResponse } from "next/server";
import { authHandler } from "@/lib/auth/handler";
import { updateCompanyInputSchema } from "@/lib/api/contract";
import { companySettingsSchema } from "@/lib/auth/schemas";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> },
): Promise<NextResponse> {
  const { companyId } = await params;
  return authHandler({
    schema: companySettingsSchema,
    authenticated: true,
    run: async (api, input, context) => {
      if (!z.uuid().safeParse(companyId).success)
        return err({ status: 404, code: "NOT_FOUND" });
      const company = await api.getCompany(context.sessionId, companyId);
      if (!company.ok) return company;
      if (
        company.value.company.kind === "management_company" &&
        !input.tradeLicenceNumber
      )
        return err({ status: 400, code: "VALIDATION_FAILED" });
      const result = await api.updateCompany(
        context.sessionId,
        companyId,
        updateCompanyInputSchema.parse(input),
        input.idempotencyKey,
      );
      return result.ok ? ok({ body: { ok: true as const } }) : result;
    },
  })(request);
}
