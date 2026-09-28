"use client";
import { useRef, useState, type ReactElement } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/system/screen-states";
import { inviteTenantAction } from "../_lib/actions";
import type { TenantDetail, Problem, Invitation } from "../_lib/j3-contract";
import type { TenantRoute } from "../_lib/routes";
type InvitationState = "accepted" | "pending" | "notInvited";
function invitationState(
  invitation: Invitation | null,
  linked: boolean,
  error: Problem | null,
  now: number,
): InvitationState {
  if (
    linked ||
    invitation?.status === "accepted" ||
    error?.code === "ALREADY_LINKED"
  )
    return "accepted";
  if (
    error?.code === "INVITATION_PENDING" ||
    (invitation?.status === "pending" && Date.parse(invitation.expiresAt) > now)
  )
    return "pending";
  return "notInvited";
}
function InvitationDetails({
  state,
  invitation,
}: {
  state: InvitationState;
  invitation: Invitation | null;
}): ReactElement | null {
  const t = useTranslations("Tenants");
  const format = useFormatter();
  if (state === "accepted") return <p>{t("invitation.linked")}</p>;
  if (state === "pending" && invitation)
    return (
      <>
        <p>{t("invitation.sent")}</p>
        <p>
          {t("invitation.validUntil")}{" "}
          <bdi>
            <time dateTime={invitation.expiresAt}>
              {format.dateTime(new Date(invitation.expiresAt), {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "Asia/Dubai",
              })}
            </time>
          </bdi>
        </p>
      </>
    );
  if (invitation?.status === "pending") return <p>{t("invitation.expired")}</p>;
  return null;
}
export function InvitationCard({
  route,
  tenant,
}: {
  route: TenantRoute;
  tenant: TenantDetail;
}): ReactElement {
  const t = useTranslations("Tenants");
  const documents = useTranslations("Documents");
  const now = useNow({ updateInterval: 60_000 });
  const [invitation, setInvitation] = useState(tenant.invitation);
  const [pending, setPending] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const busy = useRef(false);
  const state = invitationState(
    invitation,
    tenant.linkedAccount,
    error,
    now.getTime(),
  );
  async function send(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await inviteTenantAction({
        ...route,
        key: crypto.randomUUID(),
      });
      if (result.ok) {
        setInvitation(result.invitation);
        setRecorded(true);
      } else setError(result);
    } catch {
      setError({ code: "UNAVAILABLE" });
    } finally {
      setPending(false);
      busy.current = false;
    }
  }
  return (
    <section
      className="space-y-4 rounded-md border bg-card p-6"
      aria-labelledby="invitation-heading"
      aria-busy={pending}
    >
      <h2 id="invitation-heading" tabIndex={-1} className="text-h2">
        {t("invitation.title")}
      </h2>
      <p className="text-body-strong">{t(`invitation.${state}`)}</p>
      <InvitationDetails state={state} invitation={invitation} />
      {recorded && <p role="status">{t("invitation.recorded")}</p>}
      {error && (
        <ErrorSummary
          errors={[
            {
              fieldId: "invitation-heading",
              message: documents(`errors.${error.code}`),
            },
          ]}
        />
      )}
      {state === "notInvited" && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            void send();
          }}
        >
          {t(pending ? "invitation.sending" : "invitation.send")}
        </Button>
      )}
    </section>
  );
}
