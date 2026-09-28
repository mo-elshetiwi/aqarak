import { resendCode } from "@/lib/auth/actions";
import { authHandler } from "@/lib/auth/handler";
import { resendCodeSchema } from "@/lib/auth/schemas";

export const POST = authHandler({ schema: resendCodeSchema, run: resendCode });
