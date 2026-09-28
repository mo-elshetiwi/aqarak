import type { ApiModule } from "../index";
import { createContractsModule } from "./module";
import { createApprovalsModule } from "../approvals/module";
import { createNotificationsModule } from "../notifications/module";
import { createRuntime, type WorkflowOptions } from "./runtime/request";
export type { Authenticate } from "./runtime/auth";
export type { WorkflowDependencies } from "./runtime/dependencies";
export function createWorkflowModules(
  options: WorkflowOptions = {},
): readonly ApiModule[] {
  const runtime = createRuntime(options);
  return [
    createContractsModule(runtime),
    createApprovalsModule(runtime),
    createNotificationsModule(runtime),
  ];
}
