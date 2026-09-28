import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { z } from "zod";
import { useTranslations } from "use-intl";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { StatusTag } from "@/components/status/status-tag";
import { draftedActionStateSchema } from "@/components/status/states";
import { formatTime } from "@/components/format/format";
import { useLocale } from "@/features/locale/locale-provider";
/** Caller-authored text must be available in both interface languages. */
export const bilingualTextSchema = z.strictObject({
  en: z.string().min(1),
  ar: z.string().min(1),
});
/** Decision callbacks remain local and may complete synchronously or asynchronously. */
export const actionCallbackSchema = z.custom<() => void | Promise<void>>(
  (value) => typeof value === "function",
);
/** All card inputs are validated before rendering; caller strings are always plain text. */
export const draftedActionCardSchema = z
  .strictObject({
    id: z.string().min(1),
    title: bilingualTextSchema,
    state: draftedActionStateSchema,
    kind: z.enum(["action", "approval"]),
    origin: z.strictObject({
      channel: z.enum(["voice", "chat", "photo", "document"]),
      at: z.iso.datetime({ offset: true }),
    }),
    changes: z
      .array(
        z.strictObject({
          label: bilingualTextSchema,
          before: bilingualTextSchema.optional(),
          after: bilingualTextSchema,
        }),
      )
      .min(1),
    expiryRule: bilingualTextSchema,
    consequence: bilingualTextSchema,
    failureReason: bilingualTextSchema.optional(),
    commitBlockedReason: z.string().min(1).optional(),
    onConfirm: actionCallbackSchema,
    onDiscard: actionCallbackSchema,
    onEdit: actionCallbackSchema,
    onOpenReview: actionCallbackSchema,
    onDraftAgain: actionCallbackSchema,
  })
  .superRefine((value, context) => {
    if (value.state === "failed" && !value.failureReason)
      context.addIssue({
        code: "custom",
        path: ["failureReason"],
        message: "Failed actions require a reason",
      });
  });
/** Inferred props keep validation and component usage in agreement. */
export type DraftedActionCardProps = z.infer<typeof draftedActionCardSchema>;
function CardActions({ props }: { props: DraftedActionCardProps }): ReactNode {
  const t = useTranslations("Mobile.DraftedAction");
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false);
  const [failed, setFailed] = useState(false);
  const locked = useRef(false);
  async function run(
    callback: () => void | Promise<void>,
    final = false,
  ): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setFailed(false);
    try {
      await callback();
      if (final) setSettled(true);
      else locked.current = false;
    } catch {
      locked.current = false;
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  const disabled = pending || settled;
  const buttonClass = "h-auto min-h-12 py-3";
  function actions(): ReactNode {
    if (
      props.state === "committed" ||
      props.state === "rejected" ||
      props.state === "drafting"
    )
      return null;
    if (props.state === "expired" || props.state === "failed")
      return (
        <Button
          className={buttonClass}
          label={t("draftAgain")}
          loading={pending}
          disabled={disabled}
          onPress={() => {
            void run(props.onDraftAgain, true);
          }}
        />
      );
    if (props.kind === "approval")
      return (
        <Button
          className={buttonClass}
          label={t("openReview")}
          loading={pending}
          disabled={disabled}
          onPress={() => {
            void run(props.onOpenReview);
          }}
        />
      );
    return (
      <View className="gap-2">
        <Button
          className={buttonClass}
          testID="drafted-action-discard"
          variant="ghost"
          label={t("discard")}
          disabled={disabled}
          onPress={() => {
            void run(props.onDiscard, true);
          }}
        />
        <Button
          className={buttonClass}
          testID="drafted-action-edit"
          variant="secondary"
          label={t("edit")}
          disabled={disabled}
          onPress={() => {
            void run(props.onEdit);
          }}
        />
        <Button
          className={buttonClass}
          testID="drafted-action-confirm"
          label={t("confirm")}
          loading={pending}
          disabled={disabled || Boolean(props.commitBlockedReason)}
          onPress={() => {
            void run(props.onConfirm, true);
          }}
        />
        {props.commitBlockedReason && (
          <Text accessibilityRole="alert">{props.commitBlockedReason}</Text>
        )}
      </View>
    );
  }
  return (
    <View className="gap-2">
      {actions()}
      {failed && <Text accessibilityRole="alert">{t("actionFailed")}</Text>}
    </View>
  );
}
/** Reviewable changes place the caller's consequence immediately before the decision controls. */
export function DraftedActionCard(input: DraftedActionCardProps): ReactNode {
  const props = draftedActionCardSchema.parse(input);
  const { locale } = useLocale();
  const t = useTranslations("Mobile.DraftedAction");
  return (
    <View className="gap-4 rounded-lg border border-border bg-card p-4">
      <Text variant="h3">{props.title[locale]}</Text>
      <StatusTag domain="draftedAction" state={props.state} />
      <Text variant="caption" className="text-muted-foreground">
        {t(`origin.${props.origin.channel}`, {
          time: formatTime(props.origin.at),
        })}
      </Text>
      {props.changes.map((change, index) => (
        <View key={index} className="gap-1">
          <Text variant="label">{change.label[locale]}</Text>
          {change.before ? (
            <Text
              className="text-muted-foreground"
              style={{ textDecorationLine: "line-through" }}
            >
              {change.before[locale]}
            </Text>
          ) : (
            <Tag>{t("new")}</Tag>
          )}
          <Text variant="bodyStrong">{change.after[locale]}</Text>
        </View>
      ))}
      <Text>{props.expiryRule[locale]}</Text>
      {props.failureReason && props.state === "failed" && (
        <Text accessibilityRole="alert">{props.failureReason[locale]}</Text>
      )}
      <Text>{props.consequence[locale]}</Text>
      <CardActions key={props.id} props={props} />
    </View>
  );
}
