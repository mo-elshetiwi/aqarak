// I use the workspace source entry because the package root exports .ts paths that this service's compiler configuration does not accept.
export {
  withCompanyTx,
  withSystemTx,
} from "../../../../../packages/db/src/company-tx";
export type { CompanyTransaction } from "../../../../../packages/db/src/company-tx";
export type { ExecuteResult, Parameter, Row } from "@aqarak/db/data-api";
