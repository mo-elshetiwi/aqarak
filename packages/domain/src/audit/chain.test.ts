import { describe, it, expect } from "vitest";
import fc from "fast-check";
import fixture from "../../fixtures/audit/canon-v1.json";
import {
  appendToChain,
  verifyChain,
  isActorConsistent,
  auditEventContent,
  auditEventCanonicalText,
  computeRowHash,
  CANON_VERSION,
  GENESIS_PREV_HASH,
  chainBreak,
  type ChainRow,
  type ChainCheckpoint,
  type AuditEventContent,
} from "./index";

const base = auditEventContent.parse(fixture.event_cases[0]?.content);
const actorA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function buildChain(contents: readonly AuditEventContent[]): {
  readonly rows: readonly ChainRow[];
  readonly head: ChainCheckpoint | null;
} {
  return contents.reduce<{
    readonly rows: readonly ChainRow[];
    readonly head: ChainCheckpoint | null;
  }>(
    (state, content) => {
      const appended = appendToChain(state.head, content);
      return { rows: [...state.rows, appended.row], head: appended.head };
    },
    { rows: [], head: null },
  );
}

function at(rows: readonly ChainRow[], index: number): ChainRow {
  const row = rows[index];
  if (row === undefined) throw new Error("Synthetic test row is missing");
  return row;
}

function checkpoint(row: ChainRow): ChainCheckpoint {
  return { seq: row.seq, head_hash: row.row_hash };
}

const events = Array.from({ length: 5 }, (_, index) => ({
  ...base,
  seq: index + 1,
}));
const chain = buildChain(events);
const anchor = checkpoint(at(chain.rows, 2));

function forgedInsertion(rows: readonly ChainRow[]): readonly ChainRow[] {
  const forged = appendToChain(checkpoint(at(rows, 1)), {
    ...base,
    seq: 3,
    reason: "synthetic forgery",
  }).row;
  return [
    ...rows.slice(0, 2),
    forged,
    ...rows.slice(2).map((row) => ({ ...row, seq: row.seq + 1 })),
  ];
}

describe("audit chain construction", () => {
  it("starts at genesis with sequence one", () => {
    const appended = appendToChain(null, base);
    expect(appended.row.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(appended.row.seq).toBe(1);
    expect(appended.row.canon_version).toBe(CANON_VERSION);
    expect(appended.head).toEqual(checkpoint(appended.row));
  });

  it("links the next row to the previous checkpoint", () => {
    expect(at(chain.rows, 1).prev_hash).toBe(at(chain.rows, 0).row_hash);
  });

  it.each([
    [null, 2],
    [{ seq: 1, head_hash: GENESIS_PREV_HASH }, 1],
    [
      { seq: Number.MAX_SAFE_INTEGER, head_hash: GENESIS_PREV_HASH },
      Number.MAX_SAFE_INTEGER + 1,
    ],
  ] as const)(
    "rejects an unexpected next sequence for head %j",
    (head, seq) => {
      expect(() => appendToChain(head, { ...base, seq })).toThrow(RangeError);
    },
  );

  it("rejects a malformed head sequence", () => {
    expect(() =>
      appendToChain({ seq: 0, head_hash: GENESIS_PREV_HASH }, base),
    ).toThrow(TypeError);
  });

  it("rejects a malformed head hash", () => {
    expect(() =>
      appendToChain({ seq: 1, head_hash: "invalid" }, { ...base, seq: 2 }),
    ).toThrow(TypeError);
  });
});

describe("audit chain verification", () => {
  it("returns the head for five valid rows and an anchor at sequence three", () => {
    expect(verifyChain({ ...chain, anchor })).toEqual({
      ok: true,
      value: chain.head,
    });
  });

  it.each([
    {
      name: "edited content",
      rows: chain.rows.map((row) =>
        row.seq === 3
          ? {
              ...row,
              canonical_text: auditEventCanonicalText({
                ...base,
                seq: 3,
                reason: "synthetic edit",
              }),
            }
          : row,
      ),
      head: chain.head,
      anchor,
      expected: { kind: "row_hash_mismatch", seq: 3 },
    },
    {
      name: "deleted middle row",
      rows: chain.rows.filter((row) => row.seq !== 3),
      head: chain.head,
      anchor,
      expected: { kind: "seq_gap", seq: 3 },
    },
    {
      name: "truncated rows with original head",
      rows: chain.rows.slice(0, 3),
      head: chain.head,
      anchor,
      expected: { kind: "head_mismatch", seq: 5 },
    },
    {
      name: "swapped sequence numbers in sequence order",
      rows: chain.rows
        .map((row) => ({
          ...row,
          seq: row.seq === 2 ? 3 : row.seq === 3 ? 2 : row.seq,
        }))
        .sort((left, right) => left.seq - right.seq),
      head: chain.head,
      anchor,
      expected: { kind: "prev_hash_mismatch", seq: 2 },
    },
    {
      name: "duplicated third row",
      rows: [
        ...chain.rows.slice(0, 3),
        at(chain.rows, 2),
        ...chain.rows.slice(3),
      ],
      head: chain.head,
      anchor,
      expected: { kind: "seq_out_of_order", seq: 3 },
    },
    {
      name: "self-consistent forged insertion",
      rows: forgedInsertion(chain.rows),
      head: chain.head,
      anchor,
      expected: { kind: "prev_hash_mismatch", seq: 4 },
    },
    {
      name: "truncated rows and rewritten head behind anchor",
      rows: chain.rows.slice(0, 3),
      head: anchor,
      anchor: checkpoint(at(chain.rows, 3)),
      expected: { kind: "behind_anchor", seq: 4 },
    },
  ])(
    "reports the first exact break for $name",
    ({ rows, head, anchor: savedAnchor, expected }) => {
      expect(verifyChain({ rows, head, anchor: savedAnchor })).toEqual({
        ok: false,
        error: expected,
      });
      expect(chainBreak.safeParse(expected).success).toBe(true);
    },
  );

  it("returns null for an empty chain without checkpoints", () => {
    expect(verifyChain({ rows: [], head: null, anchor: null })).toEqual({
      ok: true,
      value: null,
    });
  });

  it.each([
    {
      rows: [],
      head: chain.head,
      anchor: null,
      expected: { kind: "head_mismatch", seq: 5 },
    },
    {
      rows: [],
      head: null,
      anchor,
      expected: { kind: "behind_anchor", seq: 3 },
    },
    {
      rows: chain.rows,
      head: null,
      anchor: null,
      expected: { kind: "head_mismatch", seq: 5 },
    },
    {
      rows: chain.rows,
      head: { seq: 5, head_hash: GENESIS_PREV_HASH },
      anchor: null,
      expected: { kind: "head_mismatch", seq: 5 },
    },
    {
      ...chain,
      anchor: { seq: 3, head_hash: GENESIS_PREV_HASH },
      expected: { kind: "behind_anchor", seq: 3 },
    },
    {
      rows: chain.rows.slice(1),
      head: chain.head,
      anchor: null,
      expected: { kind: "seq_gap", seq: 1 },
    },
    {
      rows: [at(chain.rows, 0), at(chain.rows, 1), at(chain.rows, 0)],
      head: chain.head,
      anchor: null,
      expected: { kind: "seq_out_of_order", seq: 1 },
    },
    {
      rows: [{ ...at(chain.rows, 0), prev_hash: "invalid" }],
      head: chain.head,
      anchor: null,
      expected: { kind: "prev_hash_mismatch", seq: 1 },
    },
  ])(
    "reports checkpoint or sequence failure %#",
    ({ rows, head, anchor: savedAnchor, expected }) => {
      expect(verifyChain({ rows, head, anchor: savedAnchor })).toEqual({
        ok: false,
        error: expected,
      });
    },
  );

  it.each([
    { ...chain, head: { seq: 0, head_hash: GENESIS_PREV_HASH }, anchor: null },
    { ...chain, anchor: { seq: -1, head_hash: GENESIS_PREV_HASH } },
    {
      rows: [{ ...at(chain.rows, 0), seq: 1.5 }],
      head: chain.head,
      anchor: null,
    },
  ])("throws for malformed programmer input %#", (input) => {
    expect(() => verifyChain(input)).toThrow(TypeError);
  });

  it("hashes each row using its own stored encoding version", () => {
    const row = at(chain.rows, 0);
    const canonVersion = "synthetic_future_version";
    const updated = {
      ...row,
      canon_version: canonVersion,
      row_hash: computeRowHash({
        prevHash: row.prev_hash,
        canonVersion,
        canonicalText: row.canonical_text,
      }),
    };
    expect(
      verifyChain({ rows: [updated], head: checkpoint(updated), anchor: null }),
    ).toEqual({ ok: true, value: checkpoint(updated) });
  });

  it("does not mutate frozen rows or checkpoints", () => {
    const frozen = Object.freeze(
      chain.rows.map((row) => Object.freeze({ ...row })),
    );
    expect(verifyChain({ rows: frozen, head: chain.head, anchor })).toEqual({
      ok: true,
      value: chain.head,
    });
    expect(frozen).toEqual(chain.rows);
  });
});

const generatedEvents = fc
  .array(
    fc.record({
      reason: fc.string(),
      changed_fields: fc.array(
        fc.constantFrom("amount_fils", "status", "reason"),
      ),
      version_after: fc.nat({ max: 1000 }),
    }),
    { minLength: 1, maxLength: 20 },
  )
  .map((values) =>
    values.map((value, index) => ({ ...base, ...value, seq: index + 1 })),
  );

describe("audit chain properties", () => {
  it("verifies random sequences of one to twenty synthetic events", () => {
    fc.assert(
      fc.property(generatedEvents, (contents) => {
        const built = buildChain(contents);
        expect(verifyChain({ ...built, anchor: null })).toEqual({
          ok: true,
          value: built.head,
        });
      }),
      // The constrained build caps properties at 100 cases while retaining the seed.
      { seed: 230301, numRuns: 100 },
    );
  }, 60_000);

  it("identifies the exact sequence of any randomly changed canonical text", () => {
    fc.assert(
      fc.property(generatedEvents, fc.nat(), (contents, selection) => {
        const built = buildChain(contents);
        const index = selection % built.rows.length;
        const rows = built.rows.map((row, position) =>
          position === index
            ? { ...row, canonical_text: `${row.canonical_text} ` }
            : row,
        );
        expect(verifyChain({ ...built, rows, anchor: null })).toEqual({
          ok: false,
          error: { kind: "row_hash_mismatch", seq: index + 1 },
        });
      }),
      // The constrained build caps properties at 100 cases while retaining the seed.
      { seed: 230302, numRuns: 100 },
    );
  }, 60_000);
});

describe("session actor consistency", () => {
  it.each([
    [null, null, true],
    [null, "", true],
    [actorA, actorA, true],
    [actorA, null, false],
    [actorA, "", false],
    [null, actorA, false],
    [actorA, actorB, false],
    [actorA, actorA.toUpperCase(), true],
  ])(
    "compares event %s with session %s and returns %s",
    (actor, session, expected) => {
      expect(isActorConsistent(actor, session)).toBe(expected);
    },
  );

  it.each([
    actorA.replaceAll("-", ""),
    `{${actorA}}`,
    "aaaa-aaaa-aaaa-4aaa-8aaa-aaaa-aaaa-aaaa",
    `{${actorA.toUpperCase().replaceAll("-", "")}}`,
  ])("accepts PostgreSQL session UUID spelling %s", (session) => {
    expect(isActorConsistent(actorA, session)).toBe(true);
  });

  it("compares UUID values without imposing version bits", () => {
    expect(
      isActorConsistent(
        "00000000-0000-0000-0000-000000000001",
        "00000000000000000000000000000001",
      ),
    ).toBe(true);
  });

  it.each([
    ["invalid", null],
    [null, "invalid"],
    ["", ""],
  ])("rejects a malformed actor or session UUID %#", (actor, session) => {
    expect(() => isActorConsistent(actor, session)).toThrow(TypeError);
  });
});
