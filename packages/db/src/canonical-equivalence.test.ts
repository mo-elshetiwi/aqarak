import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import {
  assertEquivalent,
  canonicalVectors,
  observeCanonical,
  TIMED_CANONICAL_SQL,
} from "../scripts/canonical-equivalence.ts";
import { fakeExecutor } from "./test-helpers.ts";

it("covers required synthetic canonical cases without rounding numeric inputs", () => {
  const vectors = canonicalVectors();
  expect(vectors.length).toBeGreaterThanOrEqual(40);
  expect(new Set(vectors.map(({ id }) => id)).size).toBe(vectors.length);
  expect(
    vectors.slice(0, 6).every(({ expected }) => expected !== undefined),
  ).toBe(true);
  for (let code = 1; code <= 31; code++) {
    const vector = vectors.find(
      ({ id }) => id === `control-${code.toString(16).padStart(2, "0")}`,
    );
    expect(vector?.input).toBe(
      JSON.stringify(`a${String.fromCharCode(code)}b`),
    );
  }
  for (const number of ["1.50", "-0.0", "1e3", "0.000100"]) {
    expect(vectors.some(({ input }) => input === number)).toBe(true);
  }
  expect(vectors.find(({ id }) => id === "long-47000")?.input).toBe(
    JSON.stringify("x".repeat(47_000)),
  );
  for (const vector of vectors) {
    expect(() => {
      JSON.parse(vector.input);
    }).not.toThrow();
    expect(() => {
      JSON.parse(vector.expected ?? "");
    }).not.toThrow();
  }
});

it("uses the server duration and asserts the canonical output", async () => {
  const executor = fakeExecutor();
  vi.mocked(executor.execute).mockResolvedValue({
    rows: [{ canonical: '"1.5"', server_ms: "0.123" }],
    numberOfRecordsUpdated: 0,
  });
  const observed = await observeCanonical(executor, {
    id: "number",
    input: "1.50",
    expected: '"1.5"',
  });
  expect(observed.serverMs).toBe(0.123);
  expect(executor.execute).toHaveBeenCalledExactlyOnceWith(
    TIMED_CANONICAL_SQL,
    [{ name: "value", value: "1.50", typeHint: "JSON" }],
  );
  await expect(
    observeCanonical(executor, {
      id: "bad",
      input: "1.50",
      expected: '"wrong"',
    }),
  ).rejects.toThrow("Expected vector failed: bad");
});

it("rejects changed bytes and preserves Unicode normalization distinctions", () => {
  const observation = (canonical: string) => ({
    canonical,
    serverMs: 0,
    utf8Sha256: createHash("sha256").update(canonical).digest("hex"),
  });
  expect(() => {
    assertEquivalent(observation('"é"'), observation('"é"'), "same");
  }).not.toThrow();
  expect(() => {
    assertEquivalent(observation('"é"'), observation('"e\u0301"'), "unicode");
  }).toThrow("Canonical bytes differ: unicode");
});

it("preserves all three already-applied migration hashes", async () => {
  for (const [name, hash] of [
    [
      "0001_foundation.sql",
      "bd200424caca596fe5e1df1676add4e299d891d8258bee59dc8d256669d32072",
    ],
    [
      "0002_core_and_documents.sql",
      "efae2dd58a4cd24440136e8ef5384f5d4d5f0f6f176f9fd6fdb2b3d3bbff2b5e",
    ],
    [
      "0003_linear_canonical_text.sql",
      "b87747def4c8dd4fb84e840051e067c81730ab22b00dce583038e868e17b9e88",
    ],
  ] as const) {
    const bytes = await readFile(
      new URL(`../migrations/${name}`, import.meta.url),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  }
});
