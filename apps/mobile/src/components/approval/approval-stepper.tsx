import type { ReactNode } from "react";
import { View } from "react-native";
import { Check } from "lucide-react-native";
import { z } from "zod";
import { useTranslations } from "use-intl";
import { Text } from "@/components/ui/text";
import { bilingualTextSchema } from "@/components/drafted-action/drafted-action-card";
import { formatAge, formatDate, formatTime } from "@/components/format/format";
import { useLocale } from "@/features/locale/locale-provider";
import { useThemeColors } from "@/theme/colors";
const stepSchema = z
  .strictObject({
    name: bilingualTextSchema,
    state: z.enum(["done", "current", "waiting"]),
    decision: z
      .enum(["submitted", "approved", "accepted", "changes_requested"])
      .optional(),
    decidedAt: z.iso.datetime({ offset: true }).optional(),
    requestedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((value, context) => {
    if (value.state === "done" && (!value.decision || !value.decidedAt))
      context.addIssue({
        code: "custom",
        message: "Completed steps need a decision and timestamp",
      });
    if (value.state === "current" && !value.requestedAt)
      context.addIssue({
        code: "custom",
        message: "Current steps need a request timestamp",
      });
  });
/** Frozen owner-gate input determines the actual steps, not just their styling. */
export const approvalStepperSchema = z
  .strictObject({
    ownerGate: z.boolean(),
    manager: stepSchema,
    owner: stepSchema.optional(),
    tenant: stepSchema,
    now: z.iso.datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (value.ownerGate && !value.owner)
      context.addIssue({
        code: "custom",
        path: ["owner"],
        message: "The enabled owner gate requires an owner step",
      });
  });
/** Inferred stepper props contain no fetching or mutable gate policy. */
export type ApprovalStepperProps = z.infer<typeof approvalStepperSchema>;
function ApprovalStep({
  role,
  step,
  now,
}: {
  role: "manager" | "owner" | "tenant";
  step: z.infer<typeof stepSchema>;
  now: string;
}): ReactNode {
  const t = useTranslations("Mobile.Approval");
  const { locale } = useLocale();
  const colors = useThemeColors();
  const name = step.name[locale];
  const roleLabel = t(`roles.${role}`);
  const line =
    step.state === "current" && step.requestedAt
      ? t("waiting", {
          name,
          role: roleLabel,
          age: formatAge(step.requestedAt, now, locale),
        })
      : step.decision && step.decidedAt
        ? `${t(`decisions.${step.decision}`)} · ${formatDate(step.decidedAt)} ${formatTime(step.decidedAt)}`
        : t(`step.${step.state}`);
  const dots = {
    done: "bg-status-success-solid",
    current: "border-2 border-brand bg-background",
    waiting: "border border-muted-foreground bg-background",
  };
  return (
    <View
      testID={`approval-step-${role}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${roleLabel}, ${name}, ${t(`step.${step.state}`)}, ${line}`}
      className="flex-row items-start gap-3"
    >
      <View
        className={`mt-1 h-4 w-4 items-center justify-center rounded-full ${dots[step.state]}`}
      >
        {step.state === "done" && (
          <Check size={12} color={colors.statusSuccessBg} accessible={false} />
        )}
      </View>
      <View className="flex-1 gap-1">
        <Text variant="label">{roleLabel}</Text>
        <Text>{name}</Text>
        <Text variant="body">{line}</Text>
      </View>
    </View>
  );
}
/** Ordered native children give screen readers Manager, optional Owner, then Tenant. */
export function ApprovalStepper(input: ApprovalStepperProps): ReactNode {
  const props = approvalStepperSchema.parse(input);
  return (
    <View className="gap-6">
      <ApprovalStep role="manager" step={props.manager} now={props.now} />
      {props.ownerGate && props.owner && (
        <ApprovalStep role="owner" step={props.owner} now={props.now} />
      )}
      <ApprovalStep role="tenant" step={props.tenant} now={props.now} />
    </View>
  );
}
