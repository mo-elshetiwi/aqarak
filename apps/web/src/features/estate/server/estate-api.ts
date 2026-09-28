import "server-only";
import type { Result } from "@aqarak/domain";
import { isMockApi } from "@/lib/api";
import type { EstateProblem } from "../contract";
import type { Input, Output } from "./routes";
import { createEstateHttpApi } from "./http-adapter";
import { createEstateMockApi } from "./mock-adapter";

export interface EstateApi {
  listOwners(
    sessionId: string,
    companyId: string,
    input: Input<"listOwners">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"listOwners">, EstateProblem>>;
  createOwner(
    sessionId: string,
    companyId: string,
    input: Input<"createOwner">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"createOwner">, EstateProblem>>;
  getOwner(
    sessionId: string,
    companyId: string,
    input: Input<"getOwner">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"getOwner">, EstateProblem>>;
  updateOwner(
    sessionId: string,
    companyId: string,
    input: Input<"updateOwner">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"updateOwner">, EstateProblem>>;
  putMandate(
    sessionId: string,
    companyId: string,
    input: Input<"putMandate">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"putMandate">, EstateProblem>>;
  putBankDetails(
    sessionId: string,
    companyId: string,
    input: Input<"putBankDetails">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"putBankDetails">, EstateProblem>>;
  requestOwnerUpload(
    sessionId: string,
    companyId: string,
    input: Input<"requestOwnerUpload">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"requestOwnerUpload">, EstateProblem>>;
  checkOwnerDocument(
    sessionId: string,
    companyId: string,
    input: Input<"checkOwnerDocument">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"checkOwnerDocument">, EstateProblem>>;
  acceptOwnerDocument(
    sessionId: string,
    companyId: string,
    input: Input<"acceptOwnerDocument">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"acceptOwnerDocument">, EstateProblem>>;
  rejectOwnerDocument(
    sessionId: string,
    companyId: string,
    input: Input<"rejectOwnerDocument">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"rejectOwnerDocument">, EstateProblem>>;
  inviteOwner(
    sessionId: string,
    companyId: string,
    input: Input<"inviteOwner">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"inviteOwner">, EstateProblem>>;
  listProperties(
    sessionId: string,
    companyId: string,
    input: Input<"listProperties">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"listProperties">, EstateProblem>>;
  createProperty(
    sessionId: string,
    companyId: string,
    input: Input<"createProperty">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"createProperty">, EstateProblem>>;
  getProperty(
    sessionId: string,
    companyId: string,
    input: Input<"getProperty">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"getProperty">, EstateProblem>>;
  updateProperty(
    sessionId: string,
    companyId: string,
    input: Input<"updateProperty">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"updateProperty">, EstateProblem>>;
  createUnits(
    sessionId: string,
    companyId: string,
    input: Input<"createUnits">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"createUnits">, EstateProblem>>;
  updateUnit(
    sessionId: string,
    companyId: string,
    input: Input<"updateUnit">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"updateUnit">, EstateProblem>>;
  changeUnitStatus(
    sessionId: string,
    companyId: string,
    input: Input<"changeUnitStatus">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"changeUnitStatus">, EstateProblem>>;
  requestPropertyUpload(
    sessionId: string,
    companyId: string,
    input: Input<"requestPropertyUpload">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"requestPropertyUpload">, EstateProblem>>;
  checkPropertyDocument(
    sessionId: string,
    companyId: string,
    input: Input<"checkPropertyDocument">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"checkPropertyDocument">, EstateProblem>>;
  acceptPropertyDocument(
    sessionId: string,
    companyId: string,
    input: Input<"acceptPropertyDocument">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"acceptPropertyDocument">, EstateProblem>>;
  rejectPropertyDocument(
    sessionId: string,
    companyId: string,
    input: Input<"rejectPropertyDocument">,
    ids?: string[],
    key?: string,
  ): Promise<Result<Output<"rejectPropertyDocument">, EstateProblem>>;
}
export function getEstateApi(): EstateApi {
  return isMockApi()
    ? createEstateMockApi()
    : createEstateHttpApi(process.env.AQARAK_API_BASE_URL ?? "");
}
