import * as SecureStore from "expo-secure-store";
import { z } from "zod";
const refreshKey = "aqarak.refresh_token";
const companyKey = "aqarak.active_company_id";
const refreshSchema = z.string().min(1).max(16384);
/** Session persistence contains only the refresh credential and selected company. */
export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(value: string): Promise<void>;
  getActiveCompanyId(): Promise<string | null>;
  setActiveCompanyId(value: string): Promise<void>;
  deleteSessionKeys(): Promise<void>;
}
/** Serial writes ensure a pending refresh cannot persist after queued sign-out deletion. */
export function createTokenStore(): TokenStore {
  let writes = Promise.resolve();
  function write(task: () => Promise<void>): Promise<void> {
    const next = writes.then(task, task);
    writes = next.catch(() => undefined);
    return next;
  }
  async function read(
    key: string,
    schema: z.ZodType<string>,
  ): Promise<string | null> {
    await writes;
    const raw = await SecureStore.getItemAsync(key);
    if (raw === null) return null;
    const value = schema.safeParse(raw);
    if (value.success) return value.data;
    await write(() => SecureStore.deleteItemAsync(key));
    return null;
  }
  return {
    getRefreshToken: () => read(refreshKey, refreshSchema),
    getActiveCompanyId: () => read(companyKey, z.uuid()),
    setRefreshToken: (value) =>
      write(() =>
        SecureStore.setItemAsync(refreshKey, refreshSchema.parse(value), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
      ),
    setActiveCompanyId: (value) =>
      write(() =>
        SecureStore.setItemAsync(companyKey, z.uuid().parse(value), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
      ),
    deleteSessionKeys: () =>
      write(async () => {
        const results = await Promise.allSettled([
          SecureStore.deleteItemAsync(refreshKey),
          SecureStore.deleteItemAsync(companyKey),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw new Error("Session storage could not be cleared");
      }),
  };
}
// aqarak.locale is deliberately retained on sign-out because it contains no personal data.
