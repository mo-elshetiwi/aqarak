import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useTranslations } from "use-intl";
import { PermissionRationale } from "./permission-rationale";
/** Native permission requests occur only after the person continues past a translated rationale. */
export function CameraPermission({
  mode,
  children,
}: {
  mode: "photo" | "video";
  children: ReactNode;
}): ReactNode {
  const [camera, requestCamera] = useCameraPermissions();
  const [microphone, requestMicrophone] = useMicrophonePermissions();
  const [approvedMode, setApprovedMode] = useState<"photo" | "video" | null>(
    null,
  );
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const t = useTranslations("Mobile.Capture");
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const permitted =
    approvedMode === mode ||
    (camera?.granted && (mode === "photo" || microphone?.granted));
  function stillMounted(): boolean {
    return mounted.current;
  }
  async function request(): Promise<void> {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const cameraResult = camera?.granted ? camera : await requestCamera();
      if (!stillMounted()) return;
      const audioAllowed =
        mode === "photo" ||
        (cameraResult.granted &&
          (microphone?.granted === true ||
            (await requestMicrophone()).granted));
      if (!stillMounted()) return;
      if (cameraResult.granted && audioAllowed) {
        setApprovedMode(mode);
        setDenied(false);
      } else setDenied(true);
    } catch {
      if (stillMounted()) setDenied(true);
    } finally {
      pendingRef.current = false;
      if (stillMounted()) setPending(false);
    }
  }
  if (permitted) return children;
  return (
    <PermissionRationale
      rationale={t(mode === "photo" ? "cameraRationale" : "videoRationale")}
      denied={denied}
      pending={pending}
      onContinue={() => {
        void request();
      }}
      onSettingsFailure={() => {
        setDenied(true);
      }}
    />
  );
}
