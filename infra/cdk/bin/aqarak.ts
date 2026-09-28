import { App, Validations } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { AqarakStage } from "../src/aqarak-stage";
import { getEnvironmentConfig } from "../src/config";
const app = new App();
Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
const context = {
  devAccount: app.node.tryGetContext("devAccount") as unknown,
  prodAccount: app.node.tryGetContext("prodAccount") as unknown,
};
new AqarakStage(app, "Dev", {
  config: getEnvironmentConfig("dev", context),
});
new AqarakStage(app, "Prod", {
  config: getEnvironmentConfig("prod", context),
});
app.synth();
