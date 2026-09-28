import { useState, type ReactNode } from "react";
import { Image, View } from "react-native";
import { useTranslations } from "use-intl";
import { spaceUnitPx } from "@aqarak/ui-tokens";
import { Text } from "@/components/ui/text";
import { useMediaLink } from "./hooks";

function UnavailablePhoto(): ReactNode {
  const t = useTranslations("Maintenance");
  return (
    <View className="min-h-24 justify-center rounded-lg border border-border bg-muted p-4">
      <Text>{t("photoUnavailable")}</Text>
    </View>
  );
}

function DownloadedPhoto({
  url,
  number,
}: {
  url: string;
  number: number;
}): ReactNode {
  const t = useTranslations("Maintenance");
  const [failed, setFailed] = useState(false);
  if (failed) return <UnavailablePhoto />;
  return (
    <Image
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("photo", { number })}
      source={{ uri: url }}
      resizeMode="contain"
      className="w-full rounded-lg bg-muted"
      style={{ height: spaceUnitPx * 60 }}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

/** I send only the signed URL to the native image loader, never session headers. */
export function TicketPhoto({
  mediaId,
  number,
}: {
  mediaId: string;
  number: number;
}): ReactNode {
  const t = useTranslations("Maintenance");
  const query = useMediaLink(mediaId);
  const [openedAt] = useState(Date.now);
  if (query.isFetching)
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t("loadingPhoto")}
        className="h-24 rounded-lg bg-muted"
      />
    );
  if (
    query.error ||
    !query.data ||
    Date.parse(query.data.expiresAt) <= Math.max(openedAt, query.dataUpdatedAt)
  )
    return <UnavailablePhoto />;
  return (
    <DownloadedPhoto
      key={query.data.url}
      url={query.data.url}
      number={number}
    />
  );
}
