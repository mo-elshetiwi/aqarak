"use client";
import { useState, type ComponentProps, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useHydrated } from "@/lib/client/use-hydrated";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FieldError, type FormError } from "@/components/system/screen-states";

interface FormFieldProps extends ComponentProps<"input"> {
  id: string;
  label: string;
  hint?: string;
  errors: readonly FormError[];
}
export function FormField({
  label,
  hint,
  errors,
  id,
  type,
  ...props
}: FormFieldProps): ReactElement {
  const translate = useTranslations("Auth");
  const hydrated = useHydrated();
  const [visible, setVisible] = useState(false);
  const error = errors.find((item) => item.fieldId === id);
  const password = type === "password";
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          {...props}
          id={id}
          name={id}
          type={password && visible ? "text" : type}
          disabled={!hydrated || props.disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={
            [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {password && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={translate(visible ? "hidePassword" : "showPassword")}
            onClick={() => {
              setVisible(!visible);
            }}
          >
            {visible ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${id}-error`} message={error.message} />}
    </div>
  );
}
export function SubmitButton({
  pending,
  label,
}: {
  pending: boolean;
  label: string;
}): ReactElement {
  const hydrated = useHydrated();
  return (
    <Button
      type="submit"
      className="w-full"
      disabled={pending || !hydrated}
      aria-busy={pending}
    >
      {pending && (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
      )}
      {label}
    </Button>
  );
}
