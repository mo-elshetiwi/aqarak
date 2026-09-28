import { useState, type ReactNode } from "react";
import { Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { useTranslations } from "use-intl";
import { useSession } from "@/features/auth/session-provider";
import { useLocale } from "@/features/locale/locale-provider";
import { useCaptureStorage } from "@/features/capture/capture-provider";
import { CaptureSheet } from "@/features/capture/capture-sheet";
import type { CapturedMedia } from "@/features/capture/media";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/status/status-tag";
import {
  draftedActionStateSchema,
  approvalStateSchema,
  contractStateSchema,
} from "@/components/status/states";
import {
  EmptyState,
  LoadingState,
  ErrorState,
  NotFoundState,
  ExpiredDraftState,
  PendingApprovalState,
} from "@/components/states/screen-states";
import { DraftedActionCard } from "@/components/drafted-action/drafted-action-card";
import { ApprovalReview } from "@/components/approval/approval-review";
import { ApprovalStepper } from "@/components/approval/approval-stepper";
import {
  DateText,
  Identifier,
  Money,
} from "@/components/format/formatted-text";
import {
  galleryDraft,
  galleryOwner,
  galleryReview,
  galleryStepper,
} from "@/features/gallery/examples";
import { OfflineState } from "@/features/query/connectivity";
import { formatAge } from "@/components/format/format";
function GalleryContents(): ReactNode {
  const t = useTranslations("Mobile.Gallery");
  const capture = useTranslations("Mobile.Capture");
  const { locale } = useLocale();
  const storage = useCaptureStorage();
  const [sheet, setSheet] = useState(false);
  const [items, setItems] = useState<CapturedMedia[]>([]);
  const [review, setReview] = useState<"owner" | "tenant" | null>(null);
  const [notice, setNotice] = useState(false);
  const demonstrate = (): void => {
    setNotice(true);
  };
  const kindLabel = {
    photo: capture("photo"),
    video: capture("video"),
    voice_note: capture("voiceNote"),
    document: capture("file"),
  };
  return (
    <SafeAreaView testID="gallery" className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
        <Text variant="h1">{t("title")}</Text>
        <Text>{t("synthetic")}</Text>
        {notice && <Text accessibilityRole="alert">{t("demonstrated")}</Text>}
        <Button
          label={t("openCapture")}
          onPress={() => {
            setSheet(true);
          }}
        />
        <Text variant="h2">{t("captured")}</Text>
        {items.map((item, index) => (
          <View key={item.uri} className="gap-2">
            <Text>{kindLabel[item.kind]}</Text>
            <Text>{t("size", { bytes: item.sizeBytes })}</Text>
            {item.durationMs !== undefined && (
              <Text>
                {t("duration", { seconds: Math.floor(item.durationMs / 1000) })}
              </Text>
            )}
            <Button
              variant="secondary"
              label={t("remove", { number: index + 1 })}
              onPress={() => {
                if (storage.discard(item.uri).ok)
                  setItems((current) =>
                    current.filter((entry) => entry.uri !== item.uri),
                  );
              }}
            />
          </View>
        ))}
        <Text variant="h2">{t("states")}</Text>
        <EmptyState />
        <LoadingState />
        <ErrorState onRetry={demonstrate} />
        <NotFoundState onHome={demonstrate} />
        <ExpiredDraftState onDraftAgain={demonstrate} />
        <PendingApprovalState
          name={galleryOwner(locale)}
          role="owner"
          age={formatAge("2026-09-28", "2026-10-01", locale)}
          stepper={<ApprovalStepper {...galleryStepper()} />}
        />
        <OfflineState />
        <Text variant="h2">{t("statuses")}</Text>
        {draftedActionStateSchema.options.map((state) => (
          <StatusTag key={state} domain="draftedAction" state={state} />
        ))}
        {approvalStateSchema.options.map((state) => (
          <StatusTag key={state} domain="approval" state={state} />
        ))}
        {contractStateSchema.options.map((state) => (
          <StatusTag key={state} domain="contract" state={state} />
        ))}
        <Text variant="h2">{t("formatting")}</Text>
        <Money fils={8500000} />
        <DateText value="2026-09-28" now="2026-10-01" />
        <Identifier value="784-1978-4829163-5" masked />
        <Text variant="h2">{t("drafts")}</Text>
        {draftedActionStateSchema.options.map((state) => (
          <DraftedActionCard
            key={state}
            {...galleryDraft(state, demonstrate)}
          />
        ))}
        <Text variant="h2">{t("approvals")}</Text>
        <Button
          variant="secondary"
          label={t("ownerReview")}
          onPress={() => {
            setReview("owner");
          }}
        />
        <Button
          variant="secondary"
          label={t("tenantReview")}
          onPress={() => {
            setReview("tenant");
          }}
        />
        <Text variant="h3">{t("gateOff")}</Text>
        <ApprovalStepper {...galleryStepper(false)} />
      </ScrollView>
      <CaptureSheet
        visible={sheet}
        storage={storage}
        onClose={() => {
          setSheet(false);
        }}
        onCapture={(media) => {
          setItems((current) => [...current, media]);
        }}
      />
      <Modal
        visible={review !== null}
        animationType="none"
        onRequestClose={() => {
          setReview(null);
        }}
      >
        <SafeAreaView className="flex-1 bg-background">
          <Text>{t("synthetic")}</Text>
          <Button
            variant="ghost"
            label={capture("close")}
            onPress={() => {
              setReview(null);
            }}
          />
          {review && <ApprovalReview {...galleryReview(review, demonstrate)} />}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
/** The gallery is inaccessible outside development or without an active signed-in context. */
export default function GalleryScreen(): ReactNode {
  const { state } = useSession();
  if (!__DEV__ || state.status !== "signed_in" || !state.activeCompanyId)
    return <Redirect href="/" />;
  return (
    <GalleryContents key={`${state.account.id}:${state.activeCompanyId}`} />
  );
}
