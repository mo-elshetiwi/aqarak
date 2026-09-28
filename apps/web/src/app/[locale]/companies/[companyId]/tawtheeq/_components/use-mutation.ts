"use client";
import { useRef, useState } from "react";
import type {
  ActionCommand,
  ActionFailure,
  ActionResult,
} from "../[recordId]/_actions";
export type RunAction = (
  action: ActionCommand,
  key: string,
) => Promise<ActionResult>;
export function useMutation(run: RunAction): {
  busy: boolean;
  error: ActionFailure | null;
  setError: (error: ActionFailure | null) => void;
  submit: RunAction;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const pending = useRef<Promise<ActionResult> | null>(null);
  function submit(action: ActionCommand, key: string): Promise<ActionResult> {
    if (pending.current) return pending.current;
    setBusy(true);
    setError(null);
    const task = run(action, key)
      .catch((): ActionFailure => ({
        ok: false,
        code: "UNAVAILABLE",
        fieldErrors: {},
      }))
      .then((result) => {
        if (!result.ok) setError(result);
        return result;
      })
      .finally(() => {
        setBusy(false);
        pending.current = null;
      });
    pending.current = task;
    return task;
  }
  return { busy, error, setError, submit };
}
