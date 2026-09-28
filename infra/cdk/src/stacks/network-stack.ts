import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import {
  FlowLogDestination,
  GatewayVpcEndpointAwsService,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface NetworkStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}
export class NetworkStack extends Stack {
  readonly vpc: Vpc;
  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const flowLogs = new LogGroup(this, "FlowLogs", {
      retention: props.config.logRetention,
    });
    this.vpc = new Vpc(this, "Vpc", {
      availabilityZones: props.config.availabilityZones,
      natGateways: 0,
      createInternetGateway: false,
      // No resources are attached to the default security group.
      restrictDefaultSecurityGroup: false,
      subnetConfiguration: [
        { name: "Isolated", subnetType: SubnetType.PRIVATE_ISOLATED },
      ],
      gatewayEndpoints: { S3: { service: GatewayVpcEndpointAwsService.S3 } },
      flowLogs: {
        AllTraffic: {
          destination: FlowLogDestination.toCloudWatchLogs(flowLogs),
        },
      },
    });
    new CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
  }
}
