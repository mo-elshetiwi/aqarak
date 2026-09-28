import { signIn } from "@/lib/auth/actions";
import { authHandler } from "@/lib/auth/handler";
import { signInSchema } from "@/lib/auth/schemas";

export const POST = authHandler({ schema: signInSchema, run: signIn });
