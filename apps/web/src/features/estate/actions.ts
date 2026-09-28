"use server";
import type { ActionContext, EstateActionResult } from "./contract";
import type { Input, Output } from "./server/routes";
import { runCommand } from "./server/command";
export async function createOwnerAction(
  context: ActionContext,
  input: Input<"createOwner">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"createOwner">>> {
  return runCommand("createOwner", context, input, ids);
}
export async function updateOwnerAction(
  context: ActionContext,
  input: Input<"updateOwner">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"updateOwner">>> {
  return runCommand("updateOwner", context, input, ids);
}
export async function putMandateAction(
  context: ActionContext,
  input: Input<"putMandate">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"putMandate">>> {
  return runCommand("putMandate", context, input, ids);
}
export async function putBankDetailsAction(
  context: ActionContext,
  input: Input<"putBankDetails">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"putBankDetails">>> {
  return runCommand("putBankDetails", context, input, ids);
}
export async function requestOwnerUploadAction(
  context: ActionContext,
  input: Input<"requestOwnerUpload">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"requestOwnerUpload">>> {
  return runCommand("requestOwnerUpload", context, input, ids);
}
export async function checkOwnerDocumentAction(
  context: ActionContext,
  input: Input<"checkOwnerDocument">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"checkOwnerDocument">>> {
  return runCommand("checkOwnerDocument", context, input, ids);
}
export async function acceptOwnerDocumentAction(
  context: ActionContext,
  input: Input<"acceptOwnerDocument">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"acceptOwnerDocument">>> {
  return runCommand("acceptOwnerDocument", context, input, ids);
}
export async function rejectOwnerDocumentAction(
  context: ActionContext,
  input: Input<"rejectOwnerDocument">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"rejectOwnerDocument">>> {
  return runCommand("rejectOwnerDocument", context, input, ids);
}
export async function inviteOwnerAction(
  context: ActionContext,
  input: Input<"inviteOwner">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"inviteOwner">>> {
  return runCommand("inviteOwner", context, input, ids);
}
export async function createPropertyAction(
  context: ActionContext,
  input: Input<"createProperty">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"createProperty">>> {
  return runCommand("createProperty", context, input, ids);
}
export async function updatePropertyAction(
  context: ActionContext,
  input: Input<"updateProperty">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"updateProperty">>> {
  return runCommand("updateProperty", context, input, ids);
}
export async function createUnitsAction(
  context: ActionContext,
  input: Input<"createUnits">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"createUnits">>> {
  return runCommand("createUnits", context, input, ids);
}
export async function updateUnitAction(
  context: ActionContext,
  input: Input<"updateUnit">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"updateUnit">>> {
  return runCommand("updateUnit", context, input, ids);
}
export async function changeUnitStatusAction(
  context: ActionContext,
  input: Input<"changeUnitStatus">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"changeUnitStatus">>> {
  return runCommand("changeUnitStatus", context, input, ids);
}
export async function requestPropertyUploadAction(
  context: ActionContext,
  input: Input<"requestPropertyUpload">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"requestPropertyUpload">>> {
  return runCommand("requestPropertyUpload", context, input, ids);
}
export async function checkPropertyDocumentAction(
  context: ActionContext,
  input: Input<"checkPropertyDocument">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"checkPropertyDocument">>> {
  return runCommand("checkPropertyDocument", context, input, ids);
}
export async function acceptPropertyDocumentAction(
  context: ActionContext,
  input: Input<"acceptPropertyDocument">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"acceptPropertyDocument">>> {
  return runCommand("acceptPropertyDocument", context, input, ids);
}
export async function rejectPropertyDocumentAction(
  context: ActionContext,
  input: Input<"rejectPropertyDocument">,
  ids: string[] = [],
): Promise<EstateActionResult<Output<"rejectPropertyDocument">>> {
  return runCommand("rejectPropertyDocument", context, input, ids);
}
