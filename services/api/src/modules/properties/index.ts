import type { ApiModule } from "../index";
import { createPropertiesApp } from "./routes";
export const propertiesModule: ApiModule = {
  name: "properties",
  basePath: "/v1/companies/:companyId/properties",
  register(app) {
    app.route("/", createPropertiesApp());
  },
};
