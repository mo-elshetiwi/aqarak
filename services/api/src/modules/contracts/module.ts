import { z } from "zod";
import { suggestionInput, suggestClause } from "./suggestions";
import type { ApiModule } from "../index";
import type { WorkflowRuntime } from "./runtime/request";
import { json } from "./runtime/request";
import { command, commandBody, type CommandName } from "./commands";
import {
  draftSchema,
  editSchema,
  versionSchema,
  approvalSchema,
  reasonSchema,
  listSchema,
} from "./schema";
import { detail, listContracts, draftingOptions } from "./queries";
export function createContractsModule(runtime: WorkflowRuntime): ApiModule {
  return {
    name: "contracts",
    basePath: "/v1/companies/:companyId/contracts",
    register(app) {
      app.get(
        "/",
        runtime({
          command: "list",
          schema: listSchema,
          run: async (context, body) =>
            json(await listContracts(context, body)),
        }),
      );
      app.get(
        "/drafting-options",
        runtime({
          command: "drafting_options",
          schema: z.strictObject({}),
          run: async (context) => json(await draftingOptions(context)),
        }),
      );
      app.get(
        "/:contractId",
        runtime({
          command: "read",
          schema: z.strictObject({}),
          run: async (context, _body, params) =>
            json(await detail(context, z.uuid().parse(params.contractId))),
        }),
      );
      app.post(
        "/",
        runtime({
          command: "create",
          mutation: true,
          schema: draftSchema,
          run: (context, body, params) =>
            command(context, {
              type: "create",
              body: commandBody(body),
              params,
            }),
        }),
      );
      app.put(
        "/:contractId/draft",
        runtime({
          command: "edit",
          mutation: true,
          schema: editSchema,
          run: (context, body, params) =>
            command(context, { type: "edit", body: commandBody(body), params }),
        }),
      );
      app.post(
        "/:contractId/clause-suggestions",
        runtime({
          command: "clause_suggestion",
          mutation: true,
          schema: suggestionInput,
          run: suggestClause,
        }),
      );
      const routes: readonly [string, CommandName, z.ZodType][] = [
        ["submit", "submit", versionSchema],
        ["owner-approval", "approve_owner", approvalSchema],
        ["tenant-acceptance", "accept_tenant", approvalSchema],
        ["owner-return", "return_owner", reasonSchema],
        ["tenant-return", "return_tenant", reasonSchema],
        ["withdraw", "withdraw", reasonSchema],
        ["cancel", "cancel_draft", reasonSchema],
        ["revisions", "revise", versionSchema],
      ];
      for (const [path, type, schema] of routes)
        app.post(
          `/:contractId/${path}`,
          runtime({
            command: type,
            mutation: true,
            schema,
            run: (context, body, params) =>
              command(context, { type, body: commandBody(body), params }),
          }),
        );
    },
  };
}
