import { createCompany } from "../../../lib/auth/actions";
import { authHandler } from "../../../lib/auth/handler";
import { createCompanySchema } from "../../../lib/auth/schemas";

export const POST = authHandler({
  schema: createCompanySchema,
  authenticated: true,
  run: createCompany,
});
