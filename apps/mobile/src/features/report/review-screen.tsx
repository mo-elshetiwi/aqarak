import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { IntlProvider, useTranslations } from "use-intl";
import { getMessages } from "@aqarak/i18n";
import { config } from "@/config";
import { DraftedActionCard } from "@/components/drafted-action/drafted-action-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { textStyle } from "@/theme/typography";
import { useThemeColors } from "@/theme/colors";
import { Tag } from "@/components/ui/tag";
import { Text } from "@/components/ui/text";
import { useSession } from "@/features/auth/session-provider";
import type { CapturedMedia } from "@/features/capture/media";
import { useLocale } from "@/features/locale/locale-provider";
import { companyQueryKey } from "@/features/query/cache";
import { useOnlineRequirement } from "@/features/query/connectivity";
import { asReportError, ReportError, type ReportErrorCode } from "./client";
import type { ConfirmIntakeBody, IntakeView } from "./contract";
import {
  useConfirmIntake,
  useIntake,
  useRejectIntake,
  useReportLifetime,
} from "./hooks";
import {
  ReportFailure,
  ReportPhotos,
  SafetyBanner,
  VoicePlayback,
  reportButtonClass,
} from "./presentation";

function initialText(intake: IntakeView): string {
  return intake.transcription.mode === "degraded"
    ? ""
    : (intake.transcript ?? intake.typedText ?? intake.description);
}
function changes(
  intake: IntakeView,
  text: string,
): { label: { en: string; ar: string }; after: { en: string; ar: string } }[] {
  const en = getMessages("en");
  const ar = getMessages("ar");
  const degraded = intake.triage.mode === "degraded";
  return [
    {
      label: { en: en.Report.category, ar: ar.Report.category },
      after: {
        en: degraded
          ? en.Report.degradedTriage
          : en.Maintenance.category[intake.category],
        ar: degraded
          ? ar.Report.degradedTriage
          : ar.Maintenance.category[intake.category],
      },
    },
    {
      label: { en: en.Report.priority, ar: ar.Report.priority },
      after: {
        en: degraded
          ? en.Report.degradedTriage
          : en.Maintenance.priority[intake.priority],
        ar: degraded
          ? ar.Report.degradedTriage
          : ar.Maintenance.priority[intake.priority],
      },
    },
    {
      label: { en: en.Report.safetyLabel, ar: ar.Report.safetyLabel },
      after: {
        en:
          intake.safetyFlags
            .map((flag) => en.Maintenance.safetyFlag[flag])
            .join(", ") || en.Report.noSafetyFlag,
        ar:
          intake.safetyFlags
            .map((flag) => ar.Maintenance.safetyFlag[flag])
            .join("، ") || ar.Report.noSafetyFlag,
      },
    },
    {
      label: { en: en.Report.description, ar: ar.Report.description },
      after: {
        en: text.trim() || en.Report.typePrompt,
        ar: text.trim() || ar.Report.typePrompt,
      },
    },
  ];
}
function reviewedDescription(
  intake: IntakeView | undefined,
  text: string,
  edited: string | undefined,
): string {
  return (
    edited ?? (text.length <= 1000 ? text.trim() : (intake?.description ?? ""))
  );
}
/** I keep tenant edits separate from refetched server versions until confirmation succeeds. */
export function ReviewScreen({ intakeId }: { intakeId: string }): ReactNode {
  const t = useTranslations("Report");
  const colors = useThemeColors();
  const { locale, direction } = useLocale();
  const { state } = useSession();
  const router = useRouter();
  const query = useIntake(intakeId);
  const active = useReportLifetime();
  const confirm = useConfirmIntake();
  const reject = useRejectIntake();
  const cache = useQueryClient();
  const { allowed } = useOnlineRequirement();
  const [edited, setEdited] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const [descriptionEdited, setDescriptionEdited] = useState<
    string | undefined
  >();
  const [failure, setFailure] = useState<ReportErrorCode | null>(null);
  const [uncertain, setUncertain] = useState<"confirm" | "reject" | null>(null);
  const command = useRef<ConfirmIntakeBody | null>(null);
  const rejecting = useRef<{ expectedVersion: number; reason: null } | null>(
    null,
  );
  const locked = useRef(false);
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const intake = query.data;
  const text = edited ?? (intake ? initialText(intake) : "");
  const description = reviewedDescription(intake, text, descriptionEdited);
  const minimumText = intake?.transcription.mode === "degraded" ? 3 : 1;
  const captures =
    cache.getQueryData<CapturedMedia[]>(
      companyQueryKey(state, ["report", "captures", intakeId]),
    ) ?? [];
  const voice = captures.find((item) => item.kind === "voice_note");
  const photos = captures.filter((item) => item.kind === "photo");
  const en = getMessages("en");
  const ar = getMessages("ar");
  const messages = getMessages(locale);
  const busy = confirm.isPending || reject.isPending;
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  function edit(): void {
    if (busy || uncertain) return;
    setEditing(true);
    scroll.current?.scrollTo({ y: 0, animated: false });
    input.current?.focus();
  }
  function restart(): void {
    router.replace("/report");
  }
  async function recover(error: unknown): Promise<never> {
    const problem = asReportError(error);
    if (!active()) throw problem;
    setFailure(problem.code);
    if (["STALE_VERSION", "ALREADY_DECIDED"].includes(problem.code)) {
      setEdited(text);
      command.current = null;
      rejecting.current = null;
      setUncertain(null);
      await query.refetch();
    } else if (
      problem.code !== "network_unavailable" &&
      problem.code !== "could_not_load"
    ) {
      setUncertain(null);
      command.current = null;
      rejecting.current = null;
    }
    throw problem;
  }
  async function send(): Promise<void> {
    if (
      !active() ||
      locked.current ||
      !allowed ||
      !intake ||
      text.trim().length < minimumText ||
      !description.trim() ||
      uncertain === "reject"
    )
      throw new ReportError("INVALID_INPUT");
    locked.current = true;
    setFailure(null);
    command.current ??= {
      expectedVersion: intake.version,
      transcript: text,
      category: intake.category,
      priority: intake.priority,
      safetyFlags: intake.safetyFlags,
      description: description.trim(),
    };
    setUncertain("confirm");
    try {
      const result = await confirm.mutateAsync({
        intakeId,
        body: command.current,
      });
      if (!active()) return;
      setUncertain(null);
      void cache.invalidateQueries({
        queryKey: companyQueryKey(state, ["maintenance", "tickets"]),
      });
      router.replace(`/tickets/${result.ticket.id}`);
    } catch (error) {
      await recover(error);
    } finally {
      locked.current = false;
    }
  }
  async function discard(): Promise<void> {
    if (
      !active() ||
      locked.current ||
      !allowed ||
      !intake ||
      uncertain === "confirm"
    )
      throw new ReportError("INVALID_INPUT");
    locked.current = true;
    setFailure(null);
    rejecting.current ??= { expectedVersion: intake.version, reason: null };
    setUncertain("reject");
    try {
      await reject.mutateAsync({ intakeId, body: rejecting.current });
      if (active()) router.replace("/tenant/maintenance");
    } catch (error) {
      await recover(error);
    } finally {
      locked.current = false;
    }
  }
  function voiceCard(intake: IntakeView, lockedInput: boolean): ReactNode {
    return (
      <View className="gap-3 rounded-lg border border-border bg-card p-4">
        <Text variant="h2">{t("voice")}</Text>
        {voice && <VoicePlayback uri={voice.uri} />}
        {intake.media
          .filter((item) => item.kind === "voice_note")
          .map((item) => (
            <View key={item.id}>
              <Text>
                {t("duration", {
                  seconds: Math.ceil((item.durationMs ?? 0) / 1000),
                })}
              </Text>
              {!voice && <Text>{t("noLocalPreview")}</Text>}
            </View>
          ))}
        <View className="flex-row flex-wrap items-center gap-2">
          <Text nativeID="transcript-label" variant="label">
            {t("transcript")}
          </Text>
          <Tag>{t("aiSuggested")}</Tag>
        </View>
        <TextInput
          style={[textStyle(locale, "bodyLg"), { color: colors.foreground }]}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.brand}
          ref={input}
          testID="report-transcript"
          accessibilityLabel={t("transcript")}
          accessibilityLabelledBy="transcript-label"
          multiline
          maxLength={8000}
          className="h-auto min-h-24 rounded-lg border border-input bg-background px-3 py-3"
          value={text}
          editable={
            (editing || intake.transcription.mode === "degraded") &&
            !lockedInput
          }
          onChangeText={setEdited}
          placeholder={t("typePrompt")}
        />
        {(text.length > 1000 || descriptionEdited !== undefined) && (
          <View className="gap-2">
            <Text nativeID="ticket-description-label" variant="label">
              {t("description")}
            </Text>
            <Input
              testID="report-ticket-description"
              accessibilityLabel={t("description")}
              accessibilityLabelledBy="ticket-description-label"
              multiline
              maxLength={1000}
              className="h-auto min-h-24 py-3"
              value={description}
              onChangeText={setDescriptionEdited}
              editable={editing && !lockedInput}
            />
            <Text>{t("descriptionLimit")}</Text>
          </View>
        )}
        <Button
          variant="secondary"
          className={reportButtonClass}
          label={t(editing ? "doneEditing" : "edit")}
          disabled={lockedInput}
          onPress={() => {
            if (editing) setEditing(false);
            else edit();
          }}
        />
      </View>
    );
  }
  function blockReason(): string | undefined {
    if (query.isFetching) return t("loading");
    return !allowed
      ? t("offline")
      : uncertain === "reject"
        ? t("retryDecision")
        : text.trim().length < minimumText
          ? t(minimumText === 3 ? "minText" : "typePrompt")
          : !description.trim()
            ? t("invalidInput")
            : undefined;
  }
  function content(): ReactNode {
    if (query.error)
      return (
        <ReportFailure
          code={asReportError(query.error).code}
          {...(["NOT_FOUND", "NOT_AUTHORISED"].includes(
            asReportError(query.error).code,
          )
            ? {}
            : {
                onRetry: () => {
                  void query.refetch();
                },
              })}
        />
      );
    if (!intake)
      return <Text accessibilityLiveRegion="polite">{t("loading")}</Text>;
    const unavailable = failure === "NOT_FOUND" || failure === "NOT_AUTHORISED";
    if (unavailable) return <ReportFailure code={failure} />;
    return loadedContent(intake);
  }
  function loadedContent(intake: IntakeView): ReactNode {
    const expired = intake.status === "expired" || failure === "EXPIRED";
    const decided =
      ["committed", "rejected"].includes(intake.status) ||
      failure === "ALREADY_DECIDED";
    const blockedReason = blockReason();
    return (
      <>
        {voiceCard(
          intake,
          [busy, Boolean(uncertain), expired, decided].some(Boolean),
        )}
        <ReportPhotos photos={photos} />
        {intake.media
          .filter((item) => item.kind === "photo")
          .slice(photos.length)
          .map((item, index) => (
            <View key={item.id}>
              <Text>{t("photo", { number: photos.length + index + 1 })}</Text>
              <Text>{t("noLocalPreview")}</Text>
            </View>
          ))}
        {failure && !expired && !decided && (
          <ReportFailure
            code={failure}
            onRetry={() => {
              if (
                failure === "STALE_VERSION" ||
                failure === "IDEMPOTENCY_KEY_REUSED"
              )
                void query.refetch();
              else if (uncertain === "reject")
                void discard().catch(() => undefined);
              else void send().catch(() => undefined);
            }}
          />
        )}
        {uncertain && !busy && (
          <Text accessibilityRole="alert">{t("retryDecision")}</Text>
        )}
        {expired ? (
          <ReportFailure code="EXPIRED" onRetry={restart} />
        ) : decided ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite">
            {t("decided", { status: t(`status.${intake.status}`) })}
          </Text>
        ) : (
          <IntlProvider
            locale={`${locale}-u-nu-latn`}
            timeZone="Asia/Dubai"
            messages={{
              ...messages,
              Mobile: {
                ...messages.Mobile,
                DraftedAction: {
                  ...messages.Mobile.DraftedAction,
                  confirm: messages.Report.sendReport,
                },
              },
            }}
          >
            <DraftedActionCard
              id={intake.id}
              kind="action"
              title={{ en: en.Report.details, ar: ar.Report.details }}
              state={intake.status}
              origin={{
                channel: intake.media.some((item) => item.kind === "voice_note")
                  ? "voice"
                  : "photo",
                at: intake.createdAt,
              }}
              changes={changes(intake, description)}
              expiryRule={{
                en: en.Report.expiryRule,
                ar: ar.Report.expiryRule,
              }}
              consequence={{
                en: en.Report.consequence,
                ar: ar.Report.consequence,
              }}
              failureReason={{
                en: en.Report.couldNotLoad,
                ar: ar.Report.couldNotLoad,
              }}
              {...(blockedReason ? { commitBlockedReason: blockedReason } : {})}
              onConfirm={send}
              onDiscard={discard}
              onEdit={edit}
              onDraftAgain={restart}
              onOpenReview={() => {
                scroll.current?.scrollTo({ y: 0, animated: false });
              }}
            />
          </IntlProvider>
        )}
      </>
    );
  }
  return (
    <SafeAreaView
      testID="report-review"
      className="flex-1 bg-background"
      edges={["top", "left", "right", "bottom"]}
      style={{ direction }}
    >
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 16 }}
      >
        <SafetyBanner />
        <Text variant="h1">{t("reviewTitle")}</Text>
        {config.adapter === "fixture" && <Text>{t("synthetic")}</Text>}
        {!allowed && <Text accessibilityRole="alert">{t("offline")}</Text>}
        {content()}
      </ScrollView>
    </SafeAreaView>
  );
}
