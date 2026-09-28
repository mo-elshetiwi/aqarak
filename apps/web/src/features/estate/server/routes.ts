import { z } from "zod";
import * as c from "../contract";

function route<I, O>(
  method: "GET" | "POST" | "PUT" | "PATCH",
  ...args: [
    path: (ids: string[]) => string,
    input: z.ZodType<I>,
    output: z.ZodType<O>,
    status?: number,
  ]
) {
  const [path, input, output, status = 200] = args;
  return { method, path, input, output, status };
}
const owner = (ids: string[]) => `/owners/${encodeURIComponent(ids[0] ?? "")}`;
const property = (ids: string[]) =>
  `/properties/${encodeURIComponent(ids[0] ?? "")}`;
const document = (base: typeof owner, ids: string[]) =>
  `${base(ids)}/documents/${encodeURIComponent(ids[1] ?? "")}/versions/${encodeURIComponent(ids[2] ?? "")}`;
export const routes = {
  listOwners: route(
    "GET",
    () => "/owners",
    c.ownerQuerySchema,
    c.ownerListSchema,
  ),
  createOwner: route(
    "POST",
    () => "/owners",
    c.createOwnerSchema,
    c.ownerResponseSchema,
    201,
  ),
  getOwner: route("GET", owner, c.checkInputSchema, c.ownerDetailSchema),
  updateOwner: route(
    "PATCH",
    owner,
    c.updateOwnerSchema,
    c.ownerResponseSchema,
  ),
  putMandate: route(
    "PUT",
    (ids) => `${owner(ids)}/mandate`,
    c.mandateInputSchema,
    c.mandateResponseSchema,
  ),
  putBankDetails: route(
    "PUT",
    (ids) => `${owner(ids)}/bank-details`,
    c.bankInputSchema,
    c.ownerResponseSchema,
  ),
  requestOwnerUpload: route(
    "POST",
    (ids) => `${owner(ids)}/documents`,
    c.ownerUploadSchema,
    c.uploadResponseSchema,
    201,
  ),
  checkOwnerDocument: route(
    "POST",
    (ids) => `${document(owner, ids)}/check`,
    c.checkInputSchema,
    c.checkResponseSchema,
  ),
  acceptOwnerDocument: route(
    "POST",
    (ids) => `${document(owner, ids)}/accept`,
    c.acceptInputSchema,
    c.versionResponseSchema,
  ),
  rejectOwnerDocument: route(
    "POST",
    (ids) => `${document(owner, ids)}/reject`,
    c.rejectInputSchema,
    c.versionResponseSchema,
  ),
  inviteOwner: route(
    "POST",
    (ids) => `${owner(ids)}/invitation`,
    c.invitationInputSchema,
    c.invitationResponseSchema,
    201,
  ),
  listProperties: route(
    "GET",
    () => "/properties",
    c.propertyQuerySchema,
    c.propertyListSchema,
  ),
  createProperty: route(
    "POST",
    () => "/properties",
    c.createPropertySchema,
    c.propertyResponseSchema,
    201,
  ),
  getProperty: route(
    "GET",
    property,
    c.checkInputSchema,
    c.propertyDetailSchema,
  ),
  updateProperty: route(
    "PATCH",
    property,
    c.updatePropertySchema,
    c.propertyResponseSchema,
  ),
  createUnits: route(
    "POST",
    (ids) => `${property(ids)}/units`,
    c.createUnitsSchema,
    c.unitsResponseSchema,
    201,
  ),
  updateUnit: route(
    "PATCH",
    (ids) => `${property(ids)}/units/${encodeURIComponent(ids[1] ?? "")}`,
    c.updateUnitSchema,
    c.unitResponseSchema,
  ),
  changeUnitStatus: route(
    "POST",
    (ids) =>
      `${property(ids)}/units/${encodeURIComponent(ids[1] ?? "")}/status`,
    c.unitStatusInputSchema,
    c.unitResponseSchema,
  ),
  requestPropertyUpload: route(
    "POST",
    (ids) => `${property(ids)}/documents`,
    c.propertyUploadSchema,
    c.uploadResponseSchema,
    201,
  ),
  checkPropertyDocument: route(
    "POST",
    (ids) => `${document(property, ids)}/check`,
    c.checkInputSchema,
    c.checkResponseSchema,
  ),
  acceptPropertyDocument: route(
    "POST",
    (ids) => `${document(property, ids)}/accept`,
    c.acceptInputSchema,
    c.versionResponseSchema,
  ),
  rejectPropertyDocument: route(
    "POST",
    (ids) => `${document(property, ids)}/reject`,
    c.rejectInputSchema,
    c.versionResponseSchema,
  ),
};
export type RouteName = keyof typeof routes;
export type Input<K extends RouteName> = z.infer<(typeof routes)[K]["input"]>;
export type Output<K extends RouteName> = z.infer<(typeof routes)[K]["output"]>;
