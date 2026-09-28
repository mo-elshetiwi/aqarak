"use client";
import { useState, type ReactElement, type SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { unitTransitions } from "@aqarak/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  blockReasonSchema,
  unitKindSchema,
  unitUseSchema,
  unitStatusInputSchema,
  updateUnitSchema,
  type UnitItem,
} from "../contract";
import { changeUnitStatusAction, updateUnitAction } from "../actions";
import type { FormError } from "@/components/system/screen-states";
import type { Input } from "../server/routes";
import {
  controlClass,
  Field,
  fieldAccessibility,
  FormFeedback,
  useActionContext,
  useEstateForm,
} from "./shared";

export function manualCommands(
  status: UnitItem["status"],
): Input<"changeUnitStatus">["command"][] {
  return unitStatusInputSchema.shape.command.options.filter((command) =>
    unitTransitions.some(
      (row) => row.from === status && row.command === command,
    ),
  );
}
interface UnitDialogProps {
  unit: UnitItem;
  companyId: string;
  propertyId: string;
  onClose: () => void;
  onSaved: (unit: UnitItem) => void;
}
export function UnitActions(
  props: Omit<UnitDialogProps, "onClose">,
): ReactElement {
  const t = useTranslations("Units");
  const [dialog, setDialog] = useState<"edit" | "status" | null>(null);
  const allowed = manualCommands(props.unit.status);
  const complete = (unit: UnitItem) => {
    props.onSaved(unit);
    setDialog(null);
  };
  return (
    <div className="space-y-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="secondary" />}
          aria-label={t("actionsFor", { number: props.unit.unitNo })}
        >
          {t("actions")}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={() => {
              setDialog("edit");
            }}
          >
            {t("edit")}
          </DropdownMenuItem>
          {allowed.length > 0 && (
            <DropdownMenuItem
              onClick={() => {
                setDialog("status");
              }}
            >
              {t("changeStatus")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {allowed.length === 0 && (
        <p className="text-caption">{t("followsContract")}</p>
      )}
      {dialog === "edit" && (
        <UnitEditDialog
          {...props}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={complete}
        />
      )}
      {dialog === "status" && (
        <UnitStatusDialog
          {...props}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={complete}
        />
      )}
    </div>
  );
}
export function UnitStatusDialog({
  unit,
  companyId,
  propertyId,
  onClose,
  onSaved,
}: UnitDialogProps): ReactElement {
  const t = useTranslations("Units");
  const router = useRouter();
  const form = useEstateForm("Units", "status-submit");
  const context = useActionContext(companyId, form.key);
  const commands = manualCommands(unit.status);
  const [command, setCommand] = useState<string>(commands[0] ?? "");
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = unitStatusInputSchema.safeParse({
      expectedVersion: unit.version,
      command,
      reason: data.get("reason"),
      ...(command === "block" ? { blockReason: data.get("blockReason") } : {}),
    });
    if (!parsed.success) {
      form.setErrors(
        parsed.error.issues.map((issue) => ({
          fieldId: issue.path.join("."),
          message: t(
            issue.path[0] === "blockReason"
              ? "blockReasonRequired"
              : "statusReasonRequired",
          ),
        })),
      );
      return;
    }
    if (!commands.includes(parsed.data.command)) {
      form.failure("INVALID_TRANSITION", "command");
      return;
    }
    form.submit(
      () => changeUnitStatusAction(context, parsed.data, [propertyId, unit.id]),
      (result) => {
        onSaved(result.unit);
        router.refresh();
      },
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !form.pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>{t("changeStatus")}</DialogTitle>
        <DialogDescription>
          {t("row", { number: unit.unitNo })}
        </DialogDescription>
        {commands.length ? (
          <form noValidate onSubmit={submit} className="space-y-4">
            <FormFeedback form={form} />
            <Field id="command" label={t("changeStatus")} errors={form.errors}>
              <select
                id="command"
                name="command"
                value={command}
                onChange={(event) => {
                  setCommand(event.target.value);
                }}
                className={controlClass}
                {...fieldAccessibility("command", form.errors)}
              >
                {commands.map((value) => (
                  <option key={value} value={value}>
                    {t(`commands.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            {command === "block" && (
              <Field
                id="blockReason"
                label={t("blockReason")}
                errors={form.errors}
              >
                <select
                  id="blockReason"
                  name="blockReason"
                  required
                  className={controlClass}
                  {...fieldAccessibility("blockReason", form.errors)}
                >
                  <option value="">{t("chooseBlockReason")}</option>
                  {blockReasonSchema.options.map((value) => (
                    <option key={value} value={value}>
                      {t(`blockReasons.${value}`)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field id="reason" label={t("reason")} errors={form.errors}>
              <textarea
                id="reason"
                name="reason"
                required
                maxLength={500}
                className={`${controlClass} min-h-24`}
                {...fieldAccessibility("reason", form.errors)}
              />
            </Field>
            <Button id="status-submit" type="submit" disabled={form.pending}>
              {t(form.pending ? "saving" : "save")}
            </Button>
          </form>
        ) : (
          <p>{t("followsContract")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function UnitEditDialog({
  unit,
  companyId,
  propertyId,
  onClose,
  onSaved,
}: UnitDialogProps): ReactElement {
  const t = useTranslations("Units");
  const router = useRouter();
  const form = useEstateForm("Units", "unit-submit");
  const context = useActionContext(companyId, form.key);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = updateUnitSchema.safeParse({
      expectedVersion: unit.version,
      unitNo: data.get("unitNo"),
      use: data.get("use"),
      kind: data.get("kind"),
      ...(data.get("untNumber") ? { untNumber: data.get("untNumber") } : {}),
      ...(data.get("bedrooms")
        ? { bedrooms: Number(data.get("bedrooms")) }
        : {}),
      ...(data.get("areaSqm") ? { areaSqm: data.get("areaSqm") } : {}),
    });
    if (!parsed.success) {
      form.setErrors(
        parsed.error.issues.map((issue) => ({
          fieldId: issue.path.join("."),
          message: t("problems.VALIDATION_FAILED"),
        })),
      );
      return;
    }
    form.submit(
      () => updateUnitAction(context, parsed.data, [propertyId, unit.id]),
      (result) => {
        onSaved(result.unit);
        router.refresh();
      },
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !form.pending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{t("edit")}</DialogTitle>
        <DialogDescription>
          {t("row", { number: unit.unitNo })}
        </DialogDescription>
        <form noValidate onSubmit={submit} className="space-y-4">
          <FormFeedback form={form} />
          <UnitEditFields unit={unit} errors={form.errors} />
          <Button id="unit-submit" type="submit" disabled={form.pending}>
            {t(form.pending ? "saving" : "save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function UnitEditFields({
  unit,
  errors,
}: {
  unit: UnitItem;
  errors: FormError[];
}): ReactElement {
  const t = useTranslations("Units");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["unitNo", "untNumber", "bedrooms", "areaSqm"] as const).map((id) => (
        <Field key={id} id={id} label={t(id)} errors={errors}>
          <input
            id={id}
            name={id}
            dir="ltr"
            defaultValue={unit[id] ?? ""}
            inputMode={
              id === "bedrooms" || id === "areaSqm" ? "decimal" : undefined
            }
            className={controlClass}
            {...fieldAccessibility(id, errors)}
          />
        </Field>
      ))}
      {(
        [
          ["use", unitUseSchema.options, "uses"],
          ["kind", unitKindSchema.options, "kinds"],
        ] as const
      ).map(([id, options, key]) => (
        <Field key={id} id={id} label={t(id)} errors={errors}>
          <select
            id={id}
            name={id}
            defaultValue={unit[id]}
            className={controlClass}
            {...fieldAccessibility(id, errors)}
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {t(`${key}.${value}`)}
              </option>
            ))}
          </select>
        </Field>
      ))}
    </div>
  );
}
