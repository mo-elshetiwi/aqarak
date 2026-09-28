import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { bootstrapRoles, scramSha256Verifier } from "./roles.ts";
import { fakeExecutor } from "./test-helpers.ts";

describe("runtime role bootstrap", () => {
  it("AC-4 reproduces the RFC 7677 client proof and server signature", () => {
    const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
    const verifier = scramSha256Verifier("pencil", salt);
    const keys = verifier.split("$")[2]?.split(":");
    const stored = keys?.[0];
    const server = keys?.[1];
    if (!stored || !server) throw new Error("Missing derived keys");
    const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    const auth = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
    const signature = createHmac("sha256", Buffer.from(stored, "base64"))
      .update(auth)
      .digest();
    const clientKey = createHmac(
      "sha256",
      pbkdf2Sync("pencil", salt, 4096, 32, "sha256"),
    )
      .update("Client Key")
      .digest();
    const proof = Buffer.from(
      clientKey.map((byte, index) => byte ^ (signature[index] ?? 0)),
    ).toString("base64");
    expect(proof === "dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=").toBe(true);
    expect(
      createHmac("sha256", Buffer.from(server, "base64"))
        .update(auth)
        .digest("base64") === "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
    ).toBe(true);
    expect(
      createHash("sha256").update(clientKey).digest("base64") === stored,
    ).toBe(true);
  });
  it("AC-5 rejects an unknown role before SQL or secret reads", async () => {
    const executor = fakeExecutor();
    const read = vi.fn();
    await expect(
      bootstrapRoles(
        executor,
        [
          { role: "aqarak_app", secretArn: "synthetic" },
          { role: "untrusted", secretArn: "synthetic" },
        ],
        read,
      ),
    ).rejects.toThrow("allow-list");
    expect(executor.begin).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("creates an absent role with restricted attributes and a secret-free summary", async () => {
    const executor = fakeExecutor();
    const summary = await bootstrapRoles(
      executor,
      [{ role: "aqarak_app", secretArn: "synthetic-arn" }],
      () =>
        Promise.resolve(
          JSON.stringify({
            username: "aqarak_app",
            password: "synthetic-test-password",
          }),
        ),
    );
    expect(summary).toEqual({ roles: ["aqarak_app"] });
    expect(
      executor.statements.some(({ sql }) =>
        sql.startsWith(
          "create role aqarak_app nosuperuser nobypassrls login password 'SCRAM-SHA-256$4096:",
        ),
      ),
    ).toBe(true);
    expect(
      executor.statements.some(
        ({ sql }) =>
          sql === "alter role aqarak_app nocreatedb nocreaterole inherit",
      ),
    ).toBe(true);
  });
  it("updates an existing role and never includes credential SQL in errors", async () => {
    const executor = fakeExecutor();
    vi.mocked(executor.execute)
      .mockResolvedValueOnce({
        rows: [{ present: 1, rolsuper: false, rolbypassrls: false }],
        numberOfRecordsUpdated: 0,
      })
      .mockRejectedValueOnce(new Error("Synthetic sensitive SQL"));
    await expect(
      bootstrapRoles(
        executor,
        [{ role: "aqarak_app", secretArn: "synthetic-arn" }],
        () =>
          Promise.resolve('{"username":"aqarak_app","password":"synthetic"}'),
      ),
    ).rejects.toThrow(/^Runtime role bootstrap failed: aqarak_app$/u);
    expect(executor.rollback).toHaveBeenCalled();
  });
  it("uses fresh salts and rejects unsupported credential encodings", () => {
    expect(
      scramSha256Verifier("synthetic") === scramSha256Verifier("synthetic"),
    ).toBe(false);
    expect(() => scramSha256Verifier("عقارك")).toThrow("ASCII");
    expect(() => scramSha256Verifier("synthetic", new Uint8Array(2))).toThrow(
      "16 bytes",
    );
  });
});

it.each([
  { rolsuper: true, rolbypassrls: false },
  { rolsuper: false, rolbypassrls: true },
  { rolsuper: false },
])(
  "rejects unsafe or unknown existing role flags without changing the role",
  async (attributes) => {
    const executor = fakeExecutor();
    vi.mocked(executor.execute).mockResolvedValueOnce({
      rows: [{ present: 1, ...attributes }],
      numberOfRecordsUpdated: 0,
    });
    await expect(
      bootstrapRoles(
        executor,
        [{ role: "aqarak_app", secretArn: "synthetic" }],
        () =>
          Promise.resolve('{"username":"aqarak_app","password":"synthetic"}'),
      ),
    ).rejects.toThrow("Runtime role bootstrap failed");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.rollback).toHaveBeenCalled();
    expect(executor.commit).not.toHaveBeenCalled();
  },
);
it("updates a safe existing role without ALTER SUPERUSER or BYPASSRLS", async () => {
  const executor = fakeExecutor();
  vi.mocked(executor.execute).mockResolvedValueOnce({
    rows: [{ present: 1, rolsuper: false, rolbypassrls: false }],
    numberOfRecordsUpdated: 0,
  });
  await expect(
    bootstrapRoles(
      executor,
      [{ role: "aqarak_app", secretArn: "synthetic" }],
      () => Promise.resolve('{"username":"aqarak_app","password":"synthetic"}'),
    ),
  ).resolves.toEqual({ roles: ["aqarak_app"] });
  expect(
    executor.statements.some(({ sql }) =>
      /^alter role .* (nosuperuser|nobypassrls)/u.test(sql),
    ),
  ).toBe(false);
  expect(executor.commit).toHaveBeenCalled();
});
