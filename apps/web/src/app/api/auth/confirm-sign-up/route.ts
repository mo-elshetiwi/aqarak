import { confirmSignUp } from "@/lib/auth/actions";
import { authHandler } from "@/lib/auth/handler";
import { confirmSignUpSchema } from "@/lib/auth/schemas";

export const POST = authHandler({
  schema: confirmSignUpSchema,
  run: confirmSignUp,
});
