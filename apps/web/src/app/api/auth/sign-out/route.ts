import { signOut } from "@/lib/auth/actions";
import { authHandler } from "@/lib/auth/handler";
import { signOutSchema } from "@/lib/auth/schemas";

export const POST = authHandler({
  schema: signOutSchema,
  authenticated: true,
  run: signOut,
});
