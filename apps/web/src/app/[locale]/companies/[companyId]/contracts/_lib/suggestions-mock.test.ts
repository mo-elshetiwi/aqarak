import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyChain } from "@aqarak/domain";
import { company, draft, key, setupMock } from "./test-fixtures";
import { termsInputSchema } from "./schemas";
describe("Synthetic clause suggestions", () => {
  it("replays suggestions, limits them to managers and audits confirmed and edited translations", async () => {
    const { api, login, state } = setupMock();
    const manager = await login("manager-1");
    const owner = await login("owner-1");
    const created = await api.create(manager, company, draft(), key());
    if (!created.ok) throw new Error(created.error.code);
    const id = created.value.contract.id;
    const token = key();
    const input = { textEn: "Synthetic clause" };
    const result = await api.suggestClause(manager, company, id, input, token);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.suggestion.warnings).toEqual([]);
    expect(result.value.provenance.outputSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(result.value.suggestion))
        .digest("hex"),
    );
    expect(result.value.provenance.ranAt).toBeTruthy();
    expect(await api.suggestClause(manager, company, id, input, token)).toEqual(
      result,
    );
    expect(
      await api.suggestClause(
        manager,
        company,
        id,
        { textEn: "Different" },
        token,
      ),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } });
    expect(
      await api.suggestClause(owner, company, id, input, key()),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await api.suggestClause(
        manager,
        company,
        id,
        { textEn: "Suggestions are unavailable" },
        key(),
      ),
    ).toMatchObject({ ok: false, error: { code: "MODEL_UNAVAILABLE" } });
    expect(state.suggestions.size).toBe(1);
    expect(
      state.activity.rows
        .map((row) => JSON.parse(row.canonical_text) as { event_type: string })
        .filter((event) => event.event_type === "clause_suggestion.created"),
    ).toHaveLength(1);
    const terms = termsInputSchema.strip().parse(draft());
    terms.specialClauses = [
      {
        textEn: input.textEn,
        textAr: result.value.suggestion.textAr,
        modelTranslated: true,
        suggestionId: result.value.suggestionId,
      },
    ];
    const confirmed = await api.edit(
      manager,
      company,
      id,
      { expectedVersion: 1, terms },
      key(),
    );
    expect(confirmed.ok).toBe(true);
    expect(
      JSON.parse(state.activity.rows.at(-1)?.canonical_text ?? "{}") as unknown,
    ).toMatchObject({ field_provenance: { clause_1: "ai_confirmed" } });
    const clause = terms.specialClauses[0];
    if (!clause) throw new Error("Missing clause");
    clause.textAr += " بعد التعديل";
    const edited = await api.edit(
      manager,
      company,
      id,
      { expectedVersion: 2, terms },
      key(),
    );
    expect(edited.ok).toBe(true);
    const reloaded = await api.get(manager, company, id);
    expect(reloaded).toMatchObject({
      ok: true,
      value: {
        version: {
          specialClauses: [
            {
              suggestion: {
                registryEntry: result.value.provenance.registryEntry,
                promptVersion: result.value.provenance.promptVersion,
                confirmation: "ai_edited",
              },
            },
          ],
        },
      },
    });
    expect(
      JSON.parse(state.activity.rows.at(-1)?.canonical_text ?? "{}") as unknown,
    ).toMatchObject({ field_provenance: { clause_1: "ai_edited" } });
    const submitted = await api.submit(
      manager,
      company,
      id,
      { expectedVersion: 3 },
      key(),
    );
    expect(submitted.ok).toBe(true);
    expect(
      await api.suggestClause(manager, company, id, input, key()),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSITION", status: 409 },
    });
    const other = await api.create(manager, company, draft(), key());
    if (!other.ok) throw new Error(other.error.code);
    expect(
      await api.edit(
        manager,
        company,
        other.value.contract.id,
        { expectedVersion: 1, terms },
        key(),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", field: "specialClauses.0.suggestionId" },
    });
    expect(
      await api.create(
        manager,
        company,
        { ...draft(), specialClauses: terms.specialClauses },
        key(),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      verifyChain({
        rows: state.activity.rows,
        head: state.activity.head,
        anchor: null,
      }).ok,
    ).toBe(true);
  });
});
