import type { Hono, Context } from "hono";
import { z } from "zod";
import {
  runCommand,
  runQuery,
  problemResponse,
  type CommandContext,
} from "../audit/kernel";
import type { TawtheeqDependencies } from "./dependencies";
import { domainProblemStatus } from "./problems";
import {
  createIntake,
  loadDraft,
  intakeView,
  authorizeIntake,
} from "./retroactive-repository";
import { confirmIntake } from "./retroactive-confirmation";
import { uploadIntake, completeIntakeUpload } from "./retroactive-uploads";
import { IntakeRefusal, isExclusionViolation } from "./retroactive-schemas";
import {
  extract,
  storeExtractionResult,
  persistExtraction,
  type ExtractionInput,
} from "./extraction";
import {
  prepareIntakeExtraction,
  applyIntakeExtraction,
  intakeExtractionEnvelope,
} from "./retroactive-extraction";
function draftSubject(
  c: Context,
): { type: "drafted_action"; id: string } | null {
  const id = z.uuid().safeParse(c.req.param("draftId"));
  return id.success ? { type: "drafted_action", id: id.data } : null;
}
async function bodyOf(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
async function intakeCommand(
  c: Context,
  deps: TawtheeqDependencies,
  spec: {
    name: string;
    body: unknown;
    status: 200 | 201;
    execute: (ctx: CommandContext) => Promise<unknown>;
  },
): Promise<Response> {
  const problem: { field?: string; missing?: string[] } = {};
  const response = await domainProblemStatus(
    await runCommand(c, deps, {
      subject: draftSubject(c),
      commandType: `tawtheeq.retroactive_${spec.name}`,
      body: spec.body,
      authorize: authorizeIntake,
      execute: async (ctx) => {
        try {
          return { status: spec.status, body: await spec.execute(ctx) };
        } catch (error) {
          if (error instanceof IntakeRefusal) {
            if (error.field) problem.field = error.field;
            if (error.missing.length) problem.missing = error.missing;
          }
          if (isExclusionViolation(error))
            throw new IntakeRefusal(
              "OVERLAPPING_CONTRACT",
              z.uuid().parse(c.req.param("draftId")),
            );
          throw error;
        }
      },
    }),
  );
  if (response.ok || !Object.keys(problem).length) return response;
  const body = z.record(z.string(), z.unknown()).parse(await response.json());
  return new Response(JSON.stringify({ ...body, ...problem }), {
    status: response.status,
    headers: response.headers,
  });
}
async function extractionRoute(
  c: Context,
  deps: TawtheeqDependencies,
): Promise<Response> {
  const body = await bodyOf(c);
  const reservation: {
    input?: ExtractionInput;
    draftId?: string;
    version?: number;
  } = {};
  const reserved = await intakeCommand(c, deps, {
    name: "extraction",
    body,
    status: 200,
    execute: async (ctx) => {
      const draft = await loadDraft(
        ctx,
        z.uuid().parse(c.req.param("draftId")),
      );
      reservation.input = await prepareIntakeExtraction(ctx, draft, body);
      reservation.draftId = draft.id;
      reservation.version = draft.version + 1;
      return { pending: true };
    },
  });
  if (!reserved.ok) return reserved;
  try {
    const stored: unknown = await reserved.json();
    if (
      !reservation.input &&
      !intakeExtractionEnvelope.safeParse(stored).success
    )
      return problemResponse("UNAVAILABLE", "Extraction is still pending.");
    const result = reservation.input
      ? intakeExtractionEnvelope.parse({
          ...(await extract(reservation.input, deps)),
          draftId: reservation.draftId,
          expectedVersion: reservation.version,
        })
      : intakeExtractionEnvelope.parse(stored);
    if (reservation.input)
      await storeExtractionResult(deps, reservation.input, result);
    await persistExtraction(deps, result);
    return await intakeCommand(c, deps, {
      name: "extraction_result",
      body: result,
      status: 200,
      execute: async (ctx) => {
        const draft = await loadDraft(ctx, result.draftId);
        await applyIntakeExtraction(ctx, draft, result);
        return {
          ...(await intakeView(ctx, await loadDraft(ctx, draft.id))),
          extraction: result.response,
        };
      },
    });
  } catch {
    return problemResponse("UNAVAILABLE");
  }
}
/** I keep every intake route inside the company's authenticated command boundary. */
export function registerRetroactiveRoutes(
  app: Hono,
  deps: () => TawtheeqDependencies,
): void {
  app.post("/retroactive", async (c) => {
    const body = await bodyOf(c);
    return intakeCommand(c, deps(), {
      name: "intake",
      body,
      status: 201,
      execute: (ctx) => createIntake(ctx, body),
    });
  });
  app.get("/retroactive/:draftId", (c) =>
    runQuery(c, deps(), {
      subject: draftSubject(c),
      authorize: authorizeIntake,
      execute: async (ctx) =>
        intakeView(
          ctx,
          await loadDraft(ctx, z.uuid().parse(c.req.param("draftId"))),
        ),
    }),
  );
  app.post("/retroactive/:draftId/uploads", async (c) => {
    const body = await bodyOf(c),
      dependencies = deps();
    return intakeCommand(c, dependencies, {
      name: "upload",
      body,
      status: 201,
      execute: async (ctx) =>
        uploadIntake(
          ctx,
          dependencies,
          await loadDraft(ctx, z.uuid().parse(c.req.param("draftId"))),
          body,
        ),
    });
  });
  app.post(
    "/retroactive/:draftId/uploads/:documentVersionId/complete",
    async (c) => {
      const body = await bodyOf(c),
        dependencies = deps();
      return intakeCommand(c, dependencies, {
        name: "complete",
        body,
        status: 200,
        execute: async (ctx) => {
          const draft = await loadDraft(
            ctx,
            z.uuid().parse(c.req.param("draftId")),
          );
          await completeIntakeUpload(ctx, dependencies, draft, {
            body,
            documentVersionId: z.uuid().parse(c.req.param("documentVersionId")),
          });
          return intakeView(ctx, await loadDraft(ctx, draft.id));
        },
      });
    },
  );
  app.post("/retroactive/:draftId/extraction", (c) =>
    extractionRoute(c, deps()),
  );
  app.post("/retroactive/:draftId/confirm", async (c) => {
    const body = await bodyOf(c);
    return intakeCommand(c, deps(), {
      name: "confirm",
      body,
      status: 201,
      execute: async (ctx) =>
        confirmIntake(
          ctx,
          await loadDraft(ctx, z.uuid().parse(c.req.param("draftId"))),
          body,
        ),
    });
  });
}
