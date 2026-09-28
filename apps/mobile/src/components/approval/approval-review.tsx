import { useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { z } from "zod";
import { useTranslations } from "use-intl";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/status/status-tag";
import { contractStateSchema } from "@/components/status/states";
import {
  DateText,
  Identifier,
  Money,
} from "@/components/format/formatted-text";
import {
  actionCallbackSchema,
  bilingualTextSchema,
} from "@/components/drafted-action/drafted-action-card";
import { useLocale } from "@/features/locale/locale-provider";
import { ApprovalStepper, approvalStepperSchema } from "./approval-stepper";
/** Review input is a complete immutable version, with all decisions injected as callbacks. */
export const approvalReviewSchema = z
  .strictObject({
    reference: z.string().min(1),
    viewer: z.enum(["owner", "tenant"]),
    status: contractStateSchema,
    unit: bilingualTextSchema,
    property: bilingualTextSchema,
    tenant: bilingualTextSchema,
    owner: bilingualTextSchema,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    annualRentFils: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    instalments: z.number().int().positive(),
    version: z.number().int().positive(),
    changesCount: z.number().int().nonnegative(),
    stepper: approvalStepperSchema,
    commitBlockedReason: z.string().min(1).optional(),
    onApprove: actionCallbackSchema,
    onRequestChanges: z.custom<(reason: string) => void | Promise<void>>(
      (value) => typeof value === "function",
    ),
  })
  .superRefine((value, context) => {
    if (value.endsOn < value.startsOn)
      context.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "Term end precedes its start",
      });
    if (value.viewer === "owner" && !value.stepper.ownerGate)
      context.addIssue({
        code: "custom",
        path: ["viewer"],
        message: "Owner review requires the frozen owner gate",
      });
  });
/** Parsed review props retain the schema's decision and version contract. */
export type ApprovalReviewProps = z.infer<typeof approvalReviewSchema>;
const actionClass = "h-auto min-h-12 py-3";
function ReviewDecisions({ props }: { props: ApprovalReviewProps }): ReactNode {
  const t = useTranslations("Mobile.Approval");
  const { locale } = useLocale();
  const [mode, setMode] = useState<"review" | "check" | "changes">("review");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false);
  const [failed, setFailed] = useState(false);
  const locked = useRef(false);
  const actionable =
    props.status ===
    (props.viewer === "owner"
      ? "awaiting_owner_approval"
      : "awaiting_tenant_acceptance");
  const blocked = Boolean(props.commitBlockedReason) || !actionable;
  const disabled = pending || settled || blocked;
  async function decide(callback: () => void | Promise<void>): Promise<void> {
    if (locked.current || blocked) return;
    locked.current = true;
    setPending(true);
    setFailed(false);
    try {
      await callback();
      setSettled(true);
    } catch {
      locked.current = false;
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  function requestChanges(): void {
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void decide(() => props.onRequestChanges(trimmed));
  }
  function content(): ReactNode {
    if (mode === "check")
      return (
        <View className="gap-3">
          <Text variant="h3">{t("check")}</Text>
          <Text>{t(`effect.${props.viewer}`)}</Text>
          <Text>
            {props.viewer === "owner"
              ? t("nextTenant", { name: props.tenant[locale] })
              : t("nextComplete")}
          </Text>
          <Button
            className={actionClass}
            testID="approval-confirm"
            label={t("confirmApproval")}
            loading={pending}
            disabled={disabled}
            onPress={() => {
              void decide(props.onApprove);
            }}
          />
          <Button
            className={actionClass}
            variant="ghost"
            label={t("back")}
            disabled={pending || settled}
            onPress={() => {
              setMode("review");
            }}
          />
        </View>
      );
    if (mode === "changes")
      return (
        <View className="gap-3">
          {invalid && (
            <Text accessibilityRole="alert" testID="approval-reason-summary">
              {t("reasonError")}
            </Text>
          )}
          <Text variant="label">{t("reason")}</Text>
          <Input
            testID="approval-reason"
            accessibilityLabel={t("reason")}
            multiline
            value={reason}
            onChangeText={setReason}
            editable={!disabled}
            className="h-auto min-h-24 py-3"
            style={{ textAlignVertical: "top" }}
          />
          {invalid && (
            <Text accessibilityRole="alert" testID="approval-reason-error">
              {t("reasonError")}
            </Text>
          )}
          <Button
            className={actionClass}
            testID="approval-submit-changes"
            label={t("requestChanges")}
            loading={pending}
            disabled={disabled}
            onPress={requestChanges}
          />
          <Button
            className={actionClass}
            variant="ghost"
            label={t("back")}
            disabled={pending || settled}
            onPress={() => {
              setMode("review");
            }}
          />
        </View>
      );
    return (
      <View className="gap-3">
        <Text>{t(`effect.${props.viewer}`)}</Text>
        <Button
          className={actionClass}
          testID="approval-request-changes"
          variant="secondary"
          label={t("requestChanges")}
          disabled={disabled}
          onPress={() => {
            setMode("changes");
          }}
        />
        <Button
          className={actionClass}
          testID="approval-approve"
          label={t(props.viewer === "owner" ? "approve" : "accept")}
          disabled={disabled}
          onPress={() => {
            setMode("check");
          }}
        />
      </View>
    );
  }
  return (
    <View className="gap-3">
      {content()}
      {props.commitBlockedReason && (
        <Text accessibilityRole="alert">{props.commitBlockedReason}</Text>
      )}
      {!actionable && <Text>{t("notWaiting")}</Text>}
      {failed && <Text accessibilityRole="alert">{t("failed")}</Text>}
    </View>
  );
}
/** A scrolling review and expandable controls retain access at enlarged system text sizes. */
export function ApprovalReview(input: ApprovalReviewProps): ReactNode {
  const props = approvalReviewSchema.parse(input);
  const t = useTranslations("Mobile.Approval");
  const states = useTranslations("Mobile.States");
  const { locale, direction } = useLocale();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1"
    >
      <ScrollView
        testID="approval-review"
        keyboardShouldPersistTaps="handled"
        style={{ direction }}
        contentContainerStyle={{ padding: 16, gap: 16 }}
      >
        <Text variant="h2">{t("title")}</Text>
        <Identifier value={props.reference} />
        <StatusTag domain="contract" state={props.status} />
        {(["unit", "property", "tenant", "owner"] as const).map((field) => (
          <View key={field}>
            <Text variant="label">{t(`fields.${field}`)}</Text>
            <Text>{props[field][locale]}</Text>
          </View>
        ))}
        <Text variant="label">{t("fields.term")}</Text>
        <DateText value={props.startsOn} />
        <DateText value={props.endsOn} />
        <Text variant="label">{t("fields.rent")}</Text>
        <Money fils={props.annualRentFils} />
        <Text>{t("instalments", { count: props.instalments })}</Text>
        <Text>{t("version", { version: props.version })}</Text>
        <Text>{t("changes", { count: props.changesCount })}</Text>
        <Text>{states("locked")}</Text>
        <ApprovalStepper {...props.stepper} />
        <ReviewDecisions
          key={`${props.reference}:${String(props.version)}:${props.viewer}`}
          props={props}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
