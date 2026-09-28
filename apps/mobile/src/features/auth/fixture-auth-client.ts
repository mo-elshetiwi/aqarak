import { AuthError, type AuthClient } from "./auth-client";
import {
  credentialsSchema,
  meSchema,
  signInSchema,
  refreshSchema,
  type Capacity,
  type Me,
  type SignInTokens,
} from "./contract";
// Every name and company in this fixture is synthetic.
const accounts = [
  {
    username: "manager-1",
    en: "Layla Haddad",
    ar: "ليلى حداد",
    capacity: "manager",
  },
  {
    username: "owner-1",
    en: "Khalid Al Suwaidi",
    ar: "خالد السويدي",
    capacity: "owner",
  },
  {
    username: "tenant-1",
    en: "Omar Farouk",
    ar: "عمر فاروق",
    capacity: "tenant",
  },
  {
    username: "technician-1",
    en: "Anil Kumar",
    ar: "أنيل كومار",
    capacity: "technician",
  },
  {
    username: "admin-1",
    en: "Hassan Ali",
    ar: "حسن علي",
    capacity: "company_administrator",
  },
  {
    username: "multi-1",
    en: "Noor Saleh",
    ar: "نور صالح",
    capacity: "manager",
  },
] satisfies { username: string; en: string; ar: string; capacity: Capacity }[];
/** Only synthetic usernames are disclosed on the fixture sign-in screen. */
export const demoUsernames = accounts.map((account) => account.username);
/** Fixed synthetic company identifiers make restored context selection testable. */
export const demoCompanyId = "10000000-0000-4000-8000-000000000001";
/** Local fixtures survive restart without simulating real bearer credentials. */
export function createFixtureAuthClient(
  clock: () => number = Date.now,
  locale: () => "en" | "ar" = () => "en",
): AuthClient {
  let counter = 0;
  const access = new Map<string, number>();
  const revoked = new Set<string>();
  function issue(index: number): SignInTokens {
    counter += 1;
    const token = `fixture-access-${String(index)}-${String(counter)}`;
    access.set(token, index);
    return signInSchema.parse({
      accessToken: token,
      accessTokenExpiresAt: new Date(clock() + 15 * 60_000).toISOString(),
      refreshToken: `fixture-refresh-${String(index)}-${String(counter)}`,
    });
  }
  function person(index: number): Me {
    const account = accounts[index];
    if (!account) throw new AuthError("session_ended");
    return meSchema.parse({
      account: {
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        displayName: account[locale()],
        locale: locale(),
      },
      contexts: [
        {
          companyId: demoCompanyId,
          companyName: {
            en: "Aqarak Demo Properties",
            ar: "عقارك للعقارات (تجريبي)",
          },
          isDemo: true,
          capacities: [account.capacity],
        },
        ...(account.username === "multi-1"
          ? [
              {
                companyId: "10000000-0000-4000-8000-000000000002",
                companyName: {
                  en: "Gulf Crest Trading LLC",
                  ar: "شركة غلف كرست للتجارة ذ.م.م",
                },
                isDemo: true,
                capacities: ["tenant"],
              },
            ]
          : []),
      ],
    });
  }
  return {
    signIn(credentials) {
      if (!credentialsSchema.safeParse(credentials).success)
        return Promise.reject(new AuthError("invalid_credentials"));
      const index = accounts.findIndex(
        (account) => account.username === credentials.username,
      );
      return index < 0
        ? Promise.reject(new AuthError("invalid_credentials"))
        : Promise.resolve(issue(index));
    },
    refresh(token) {
      const match = /^fixture-refresh-(\d+)-(\d+)$/.exec(token);
      const index = Number(match?.[1]);
      if (!match || !accounts[index] || revoked.has(token))
        return Promise.reject(new AuthError("session_ended"));
      return Promise.resolve(refreshSchema.parse(issue(index)));
    },
    signOut(token, refresh) {
      access.delete(token);
      revoked.add(refresh);
      return Promise.resolve();
    },
    getMe(token) {
      const index = access.get(token);
      return index === undefined
        ? Promise.reject(new AuthError("session_ended"))
        : Promise.resolve(person(index));
    },
  };
}
