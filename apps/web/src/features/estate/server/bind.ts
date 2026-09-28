import type { Result } from "@aqarak/domain";
import type { EstateProblem } from "../contract";
import type { EstateApi } from "./estate-api";
import type { Input, Output, RouteName } from "./routes";
export type Execute = <K extends RouteName>(
  name: K,
  ...args: [
    sessionId: string,
    companyId: string,
    input: Input<K>,
    ids?: string[],
    key?: string,
  ]
) => Promise<Result<Output<K>, EstateProblem>>;
export function bindApi(execute: Execute): EstateApi {
  return {
    listOwners: (...args) => execute("listOwners", ...args),
    createOwner: (...args) => execute("createOwner", ...args),
    getOwner: (...args) => execute("getOwner", ...args),
    updateOwner: (...args) => execute("updateOwner", ...args),
    putMandate: (...args) => execute("putMandate", ...args),
    putBankDetails: (...args) => execute("putBankDetails", ...args),
    requestOwnerUpload: (...args) => execute("requestOwnerUpload", ...args),
    checkOwnerDocument: (...args) => execute("checkOwnerDocument", ...args),
    acceptOwnerDocument: (...args) => execute("acceptOwnerDocument", ...args),
    rejectOwnerDocument: (...args) => execute("rejectOwnerDocument", ...args),
    inviteOwner: (...args) => execute("inviteOwner", ...args),
    listProperties: (...args) => execute("listProperties", ...args),
    createProperty: (...args) => execute("createProperty", ...args),
    getProperty: (...args) => execute("getProperty", ...args),
    updateProperty: (...args) => execute("updateProperty", ...args),
    createUnits: (...args) => execute("createUnits", ...args),
    updateUnit: (...args) => execute("updateUnit", ...args),
    changeUnitStatus: (...args) => execute("changeUnitStatus", ...args),
    requestPropertyUpload: (...args) =>
      execute("requestPropertyUpload", ...args),
    checkPropertyDocument: (...args) =>
      execute("checkPropertyDocument", ...args),
    acceptPropertyDocument: (...args) =>
      execute("acceptPropertyDocument", ...args),
    rejectPropertyDocument: (...args) =>
      execute("rejectPropertyDocument", ...args),
  };
}
