"use client";
import { useEffect, useRef, useState } from "react";
import type { ActionFailure } from "../[recordId]/_actions";
import type { RunAction } from "./use-mutation";

const interval = 3_000;
const duration = 60_000;
export function useUploadCompletion({
  submit,
  expectedVersion,
  setError,
  rejectFile,
}: {
  submit: RunAction;
  expectedVersion: number;
  setError: (error: ActionFailure | null) => void;
  rejectFile: () => void;
}): {
  scanning: boolean;
  documentId: string | null;
  complete: (id: string, version: number) => Promise<void>;
  reset: () => void;
} {
  const [scanning, setScanning] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const current = useRef({ submit, expectedVersion, setError, rejectFile });
  const mounted = useRef(true);
  const cancelWait = useRef<(() => void) | null>(null);
  useEffect(() => {
    current.current = { submit, expectedVersion, setError, rejectFile };
  }, [submit, expectedVersion, setError, rejectFile]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelWait.current?.();
    };
  }, []);
  function wait(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cancelWait.current = null;
        resolve(true);
      }, ms);
      cancelWait.current = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
  }
  const isMounted = (): boolean => mounted.current;
  async function complete(id: string, version: number): Promise<void> {
    const deadline = Date.now() + duration;
    setDocumentId(id);
    let nextVersion = version;
    while (isMounted()) {
      const result = await current.current.submit(
        {
          command: "completeUpload",
          input: { documentVersionId: id, expectedVersion: nextVersion },
        },
        crypto.randomUUID(),
      );
      if (!isMounted()) return;
      if (result.ok) {
        setDocumentId(null);
        setScanning(false);
        return;
      }
      const code = result.domainCode ?? result.code;
      if (code !== "SCAN_PENDING") {
        setScanning(false);
        if (code === "SCAN_REJECTED" || code === "CHECKSUM_MISMATCH") {
          setDocumentId(null);
          current.current.rejectFile();
        }
        return;
      }
      current.current.setError(null);
      setScanning(true);
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      if (!(await wait(Math.min(interval, remaining)))) return;
      if (Date.now() >= deadline) return;
      nextVersion = current.current.expectedVersion;
    }
  }
  function reset(): void {
    setDocumentId(null);
    setScanning(false);
  }
  return { scanning, documentId, complete, reset };
}
