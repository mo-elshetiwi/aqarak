import { Stage, type StageProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config";
import { FoundationStack } from "./foundation-stack";
import { NetworkStack } from "./stacks/network-stack";
import { DatabaseOpsStack } from "./stacks/database-ops-stack";
import { DataStack } from "./stacks/data-stack";

import { IdentityStack } from "./stacks/identity-stack";
import { StorageStack } from "./stacks/storage-stack";
import { EmailStack } from "./stacks/email-stack";
import { ApiStack } from "./stacks/api-stack";

export interface AqarakStageProps extends StageProps {
  readonly config: EnvironmentConfig;
}
/** Creates the same stack boundaries for each explicitly configured environment. */
export class AqarakStage extends Stage {
  readonly foundation: FoundationStack;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly databaseOps: DatabaseOpsStack;
  readonly identity: IdentityStack;
  readonly storage: StorageStack;
  readonly email: EmailStack;
  readonly api: ApiStack;
  constructor(scope: Construct, id: string, props: AqarakStageProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.account, region: props.config.region },
    });
    const { config } = props;
    // Explicit zone context lets both stages synthesise without account lookups.
    this.node.setContext(
      `availability-zones:account=${config.account}:region=${config.region}`,
      config.availabilityZones,
    );
    this.foundation = new FoundationStack(this, "FoundationStack", { config });
    this.network = new NetworkStack(this, "NetworkStack", { config });
    this.data = new DataStack(this, "DataStack", {
      config,
      vpc: this.network.vpc,
      dataKey: this.foundation.dataKey,
    });
    this.databaseOps = new DatabaseOpsStack(this, "DatabaseOpsStack", {
      config,
      data: this.data,
      dataKey: this.foundation.dataKey,
    });
    this.databaseOps.addStackDependency(this.data);
    this.identity = new IdentityStack(this, "IdentityStack", { config });
    this.storage = new StorageStack(this, "StorageStack", {
      config,
      dataKey: this.foundation.dataKey,
      accessLogsBucket: this.foundation.accessLogsBucket,
    });
    this.email = new EmailStack(this, "EmailStack");
    this.api = new ApiStack(this, "ApiStack", {
      config,
      data: this.data,
      identity: this.identity,
      storage: this.storage,
      email: this.email,
    });
  }
}
