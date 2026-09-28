import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Tag } from "@/components/ui/tag";
import type { TicketView } from "@/features/report/contract";
/** I display the server status with its bilingual maintenance label. */
export function TicketStatusTag({
  status,
}: {
  status: TicketView["status"];
}): ReactNode {
  const t = useTranslations("Maintenance");
  return (
    <Tag
      tone={status === "reported" ? "attention" : "neutral"}
      accessibilityLabel={t(`status.${status}`)}
    >
      {t(`status.${status}`)}
    </Tag>
  );
}
