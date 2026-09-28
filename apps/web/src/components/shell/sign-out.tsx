"use client";
import { useRef, useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson, navigateDocument } from "@/lib/client/post-json";
import { useCsrfToken } from "./session-context";
export function SignOut(): ReactElement {
  const translate = useTranslations("Shell");
  const auth = useTranslations("Auth");
  const locale = useLocale();
  const csrfToken = useCsrfToken();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    const result = await postJson(
      "/api/auth/sign-out",
      { locale },
      csrfToken ? { csrfToken } : {},
    );
    if (result.ok) navigateDocument(result.redirectTo);
    else setFailed(true);
    busy.current = false;
    setPending(false);
  }
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          void signOut();
        }}
      >
        {pending && (
          <LoaderCircle
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {translate("signOut")}
      </Button>
      {failed && (
        <p role="alert" className="text-status-danger-fg">
          {auth("UNAVAILABLE")}
        </p>
      )}
    </div>
  );
}
