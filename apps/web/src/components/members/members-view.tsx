"use client";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { domainLabel, type Locale } from "@aqarak/i18n";
import type { Invitation, Membership } from "@/lib/api/contract";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  ErrorState,
  OfflineBanner,
} from "@/components/system/screen-states";
import { StatusTag } from "@/components/system/status-tag";
import { InvitationActions } from "./invitation-actions";
import { MemberActions } from "./member-actions";
import { InviteSheet } from "./invite-sheet";
const cell = "h-11 ps-4 pe-4 text-start align-middle";
const deliveryKeys = {
  not_configured: "deliveryNotConfigured",
  sent: "deliverySent",
  failed: "deliveryFailed",
} as const;
export function MembersView({
  companyId,
  accountId,
  members,
  invitations,
}: {
  companyId: string;
  accountId: string;
  members: Membership[] | null;
  invitations: Invitation[] | null;
}): ReactElement {
  const t = useTranslations("Members");
  const locale = useLocale() as Locale;
  const router = useRouter();
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-h1">{t("title")}</h1>
          <p className="text-body text-muted-foreground">{t("description")}</p>
        </div>
        <InviteSheet companyId={companyId} />
      </header>
      <OfflineBanner />
      {!members || !invitations ? (
        <ErrorState
          onRetry={() => {
            router.refresh();
          }}
          message={t("UNAVAILABLE")}
        />
      ) : (
        <>
          {members.length > 0 &&
            !members.some(
              (member) =>
                member.accountId !== accountId && member.status !== "removed",
            ) && <EmptyState variant="no-records" message={t("noMembers")} />}
          {members.length ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-body">
                <caption className="sr-only">{t("title")}</caption>
                <thead className="bg-muted text-label">
                  <tr>
                    {(
                      ["name", "email", "roles", "status", "actions"] as const
                    ).map((key) => (
                      <th key={key} scope="col" className={cell}>
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.membershipId} className="border-t">
                      <th scope="row" className={cn(cell, "font-medium")}>
                        {member.displayName ?? t("notAvailable")}
                      </th>
                      <td className={cell}>
                        <bdi dir="ltr">{member.email ?? t("notAvailable")}</bdi>
                      </td>
                      <td className={cell}>
                        {member.staffRoles
                          .map((role) => domainLabel(locale, "staffRole", role))
                          .join(locale === "ar" ? "، " : ", ")}
                      </td>
                      <td className={cell}>
                        <StatusTag entity="membership" state={member.status} />
                      </td>
                      <td className={cell}>
                        <MemberActions
                          companyId={companyId}
                          member={member}
                          own={member.accountId === accountId}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState variant="no-records" message={t("noMembers")} />
          )}
          <section aria-labelledby="invitations-title" className="space-y-4">
            <h2 id="invitations-title" className="text-h2">
              {t("invitations")}
            </h2>
            {!invitations.some((item) => item.status === "pending") && (
              <EmptyState
                variant="no-records"
                headingLevel="h3"
                message={t("noPending")}
              />
            )}
            {invitations.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-body">
                  <caption className="sr-only">{t("invitations")}</caption>
                  <thead className="bg-muted text-label">
                    <tr>
                      {(
                        [
                          "email",
                          "roles",
                          "status",
                          "delivery",
                          "expires",
                          "actions",
                        ] as const
                      ).map((key) => (
                        <th key={key} scope="col" className={cell}>
                          {t(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map((invitation) => (
                      <tr key={invitation.id} className="border-t">
                        <th scope="row" className={cn(cell, "font-medium")}>
                          <bdi dir="ltr">{invitation.email}</bdi>
                        </th>
                        <td className={cell}>
                          {invitation.staffRoles
                            .map((role) =>
                              domainLabel(locale, "staffRole", role),
                            )
                            .join(locale === "ar" ? "، " : ", ")}
                        </td>
                        <td className={cell}>
                          <StatusTag
                            entity="invitation"
                            state={invitation.status}
                          />
                        </td>
                        <td className={cell}>
                          {t(deliveryKeys[invitation.deliveryStatus])}
                        </td>
                        <td className={cell}>
                          <time dateTime={invitation.expiresAt} dir="ltr">
                            {formatDate(invitation.expiresAt, locale)}
                          </time>
                        </td>
                        <td className={cell}>
                          <InvitationActions
                            companyId={companyId}
                            invitation={invitation}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
