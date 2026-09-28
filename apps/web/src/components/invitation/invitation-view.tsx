"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { domainLabel, type Locale } from "@aqarak/i18n";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ErrorState,
  NotFoundState,
  OfflineBanner,
} from "@/components/system/screen-states";
import { StatusTag } from "@/components/system/status-tag";
import { useCsrfToken } from "@/components/shell/session-context";
import {
  invitationPreviewSchema,
  type InvitationPreview,
} from "@/lib/api/contract";
import {
  navigateDocument,
  postJson,
  postJsonData,
} from "@/lib/client/post-json";
import { formatDate } from "@/lib/format";
import {
  capturePendingInvitation,
  clearPendingInvitation,
  readPendingInvitation,
} from "./pending-invitation";
type PreviewState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "failed"; storage: boolean }
  | { kind: "ready"; invitation: InvitationPreview["invitation"] };
export function InvitationView({
  signedIn,
  sessionUnavailable = false,
}: {
  signedIn: boolean;
  sessionUnavailable?: boolean;
}): ReactElement {
  const locale = useLocale() as Locale;
  const t = useTranslations("Members");
  const csrfToken = useCsrfToken();
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const busy = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const current = ++revision.current;
    const captured = capturePendingInvitation(locale);
    if (captured.storageUnavailable) {
      setState({ kind: "failed", storage: true });
      return;
    }
    if (!captured.token) {
      setState({ kind: "missing" });
      return;
    }
    setState({ kind: "loading" });
    const result = await postJsonData(
      "/api/invitations/preview",
      { token: captured.token },
      invitationPreviewSchema,
    );
    if (current !== revision.current) return;
    if (result.ok)
      setState({ kind: "ready", invitation: result.data.invitation });
    else if (result.code === "NOT_FOUND" || result.code === "VALIDATION_FAILED")
      setState({ kind: "missing" });
    else setState({ kind: "failed", storage: false });
  }, [locale]);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void load();
    });
    return () => {
      disposed = true;
      revision.current += 1;
    };
  }, [load]);
  async function accept(): Promise<void> {
    if (busy.current) return;
    const invitation = readPendingInvitation(locale);
    if (!invitation) {
      setState({ kind: "missing" });
      return;
    }
    busy.current = true;
    setPending(true);
    setCode("");
    const result = await postJson(
      "/api/invitations/accept",
      { locale, token: invitation.token, idempotencyKey },
      csrfToken ? { csrfToken } : {},
    );
    if (result.ok) {
      clearPendingInvitation();
      navigateDocument(result.redirectTo);
    } else setCode(result.code);
    busy.current = false;
    setPending(false);
  }
  async function signOut(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const result = await postJson(
      "/api/auth/sign-out",
      { locale },
      csrfToken ? { csrfToken } : {},
    );
    if (result.ok)
      navigateDocument(`/${locale}/sign-in?next=/${locale}/invitation`);
    else setCode(result.code);
    busy.current = false;
    setPending(false);
  }
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto min-h-dvh max-w-2xl space-y-8 ps-6 pe-6 pt-12 pb-12"
    >
      <header className="space-y-2">
        <h1 className="text-h1">{t("invitationTitle")}</h1>
        <p className="text-body text-muted-foreground">
          {t("invitationDescription")}
        </p>
      </header>
      <OfflineBanner />
      {sessionUnavailable ? (
        <ErrorState
          message={t("UNAVAILABLE")}
          onRetry={() => {
            window.location.reload();
          }}
        />
      ) : state.kind === "loading" ? (
        <p role="status">{t("loading")}</p>
      ) : state.kind === "missing" ? (
        <NotFoundState />
      ) : state.kind === "failed" ? (
        <ErrorState
          message={t(state.storage ? "storageUnavailable" : "UNAVAILABLE")}
          onRetry={() => {
            void load();
          }}
        />
      ) : (
        <InvitationDetails
          invitation={state.invitation}
          code={code}
          signedIn={signedIn}
          pending={pending}
          onAccept={() => {
            void accept();
          }}
          onSignOut={() => {
            void signOut();
          }}
          onReload={() => {
            setCode("");
            void load();
          }}
        />
      )}
    </main>
  );
}

function InvitationDetails({
  invitation,
  code,
  signedIn,
  pending,
  onAccept,
  onSignOut,
  onReload,
}: {
  invitation: InvitationPreview["invitation"];
  code: string;
  signedIn: boolean;
  pending: boolean;
  onAccept: () => void;
  onSignOut: () => void;
  onReload: () => void;
}): ReactElement {
  const locale = useLocale() as Locale;
  const t = useTranslations("Members");
  const refusal =
    (
      [
        "INVITATION_NOT_PENDING",
        "INVITATION_EMAIL_MISMATCH",
        "ACTIVE_MEMBERSHIP_ELSEWHERE",
        "PARTY_ALREADY_LINKED",
        "SESSION_INVALID",
        "FORBIDDEN",
      ] as const
    ).find((item) => item === code) ?? "UNAVAILABLE";
  const signInPath = `/${locale}/sign-in?next=/${locale}/invitation`;
  return (
    <>
      <section
        className="space-y-6 rounded-md border bg-card p-6"
        aria-labelledby="invited-company"
      >
        <div className="space-y-2">
          <h2 id="invited-company" className="text-h2" lang={locale}>
            {invitation.companyName[locale]}
          </h2>
          <p
            className="text-body text-muted-foreground"
            lang={locale === "en" ? "ar" : "en"}
            dir={locale === "en" ? "rtl" : "ltr"}
          >
            {invitation.companyName[locale === "en" ? "ar" : "en"]}
          </p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-muted-foreground">{t("roles")}</dt>
            <dd>
              {invitation.kind === "staff"
                ? invitation.staffRoles
                    .map((role) => domainLabel(locale, "staffRole", role))
                    .join(locale === "ar" ? "، " : ", ")
                : domainLabel(locale, "role", invitation.kind)}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">
              {t("invitedEmail")}
            </dt>
            <dd>
              <bdi dir="ltr">{invitation.maskedEmail}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">
              {t("expires")}
            </dt>
            <dd>
              <time dir="ltr" dateTime={invitation.expiresAt}>
                {formatDate(invitation.expiresAt, locale)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">
              {t("status")}
            </dt>
            <dd>
              <StatusTag entity="invitation" state={invitation.status} />
            </dd>
          </div>
        </dl>
      </section>
      {invitation.status !== "pending" ? (
        <p role="status" className="rounded-md border bg-muted p-4">
          {t(invitation.status)}
        </p>
      ) : (
        <>
          {code &&
            (code === "NOT_FOUND" ? (
              <NotFoundState />
            ) : (
              <p
                role="alert"
                className="rounded-md border border-status-danger-border bg-status-danger-bg p-4 text-status-danger-fg"
              >
                {t(refusal, { email: invitation.maskedEmail })}
              </p>
            ))}
          {signedIn ? (
            <div className="flex flex-wrap gap-4">
              <Button
                disabled={pending}
                aria-busy={pending}
                onClick={() => {
                  onAccept();
                }}
              >
                {t("accept")}
              </Button>
              {code && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    onSignOut();
                  }}
                >
                  {t("signOut")}
                </Button>
              )}
              {code === "INVITATION_NOT_PENDING" && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onReload();
                  }}
                >
                  {t("retry")}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              <a href={signInPath} className={buttonVariants()}>
                {t("signInToAccept")}
              </a>
              <a
                href={`/${locale}/sign-up`}
                className={buttonVariants({ variant: "outline" })}
              >
                {t("createAccount")}
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}
