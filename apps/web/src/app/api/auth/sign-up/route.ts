import { signUp } from "@/lib/auth/actions";
import { authHandler } from "@/lib/auth/handler";
import { signUpSchema } from "@/lib/auth/schemas";

export const POST = authHandler({ schema: signUpSchema, run: signUp });
