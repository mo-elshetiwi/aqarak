import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import { SecurityGroup, SubnetType, type IVpc } from "aws-cdk-lib/aws-ec2";
import type { IKey } from "aws-cdk-lib/aws-kms";
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
  DatabaseSecret,
  ParameterGroup,
} from "aws-cdk-lib/aws-rds";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface DataStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: IVpc;
  readonly dataKey: IKey;
}
export class DataStack extends Stack {
  readonly cluster: DatabaseCluster;
  readonly masterSecret: DatabaseSecret;
  readonly appSecret: DatabaseSecret;
  readonly pipelineSecret: DatabaseSecret;
  readonly schedulerSecret: DatabaseSecret;
  readonly databaseName = "aqarak";
  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const engine = DatabaseClusterEngine.auroraPostgres({
      version: AuroraPostgresEngineVersion.VER_17_9,
    });
    const securityGroup = new SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: false,
      description: "I allow database access only through the RDS Data API.",
    });
    const parameters = new ParameterGroup(this, "ClusterParameters", {
      engine,
      parameters: { timezone: "UTC", "rds.force_ssl": "1" },
    });
    this.masterSecret = new DatabaseSecret(this, "MasterSecret", {
      username: "postgres",
      encryptionKey: props.dataKey,
    });
    this.cluster = new DatabaseCluster(this, "Cluster", {
      engine,
      writer: ClusterInstance.serverlessV2("Writer"),
      readers: [],
      serverlessV2MinCapacity: props.config.databaseMinCapacity,
      serverlessV2MaxCapacity: props.config.databaseMaxCapacity,
      serverlessV2AutoPauseDuration: props.config.databaseAutoPauseDuration,
      enableDataApi: true,
      defaultDatabaseName: this.databaseName,
      credentials: Credentials.fromSecret(this.masterSecret),
      storageEncrypted: true,
      storageEncryptionKey: props.dataKey,
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [securityGroup],
      parameterGroup: parameters,
      backup: { retention: Duration.days(props.config.databaseBackupDays) },
      deletionProtection: props.config.deletionProtection,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      iamAuthentication: false,
    });
    const roleSecret = (
      constructId: string,
      username: string,
    ): DatabaseSecret => {
      const secret = new DatabaseSecret(this, constructId, {
        username,
        encryptionKey: props.dataKey,
        excludeCharacters: " !\"#$%&'()*+,/:;<=>?@[\\]^`{|}",
      });
      secret.attach(this.cluster);
      return secret;
    };
    this.appSecret = roleSecret("AppSecret", "aqarak_app");
    this.pipelineSecret = roleSecret("PipelineSecret", "aqarak_pipeline");
    this.schedulerSecret = roleSecret("SchedulerSecret", "aqarak_scheduler");
    for (const secret of [
      this.masterSecret,
      this.appSecret,
      this.pipelineSecret,
      this.schedulerSecret,
    ]) {
      secret.applyRemovalPolicy(RemovalPolicy.RETAIN);
      Validations.of(secret).acknowledge({
        id: "AwsSolutions-SMG4",
        reason:
          "Database secret rotation requires a rotation function with network access to the cluster and is deferred to a later change.",
      });
    }
    Validations.of(this.cluster).acknowledge({
      id: "AwsSolutions-RDS6",
      reason:
        "Data API requests authenticate with Secrets Manager rather than IAM database authentication.",
    });
    Validations.of(this.cluster).acknowledge({
      id: "AwsSolutions-RDS11",
      reason:
        "The database port has no exposed network path; the security group has no ingress and access is through the Data API.",
    });
    if (!props.config.deletionProtection) {
      Validations.of(this.cluster).acknowledge({
        id: "AwsSolutions-RDS10",
        reason:
          "Deletion protection is disabled for the development cluster; stack termination protection and snapshot removal remain enabled.",
      });
    }
    const outputs = {
      ClusterArn: this.cluster.clusterArn,
      ClusterIdentifier: this.cluster.clusterIdentifier,
      MasterSecretArn: this.masterSecret.secretArn,
      AppSecretArn: this.appSecret.secretArn,
      PipelineSecretArn: this.pipelineSecret.secretArn,
      SchedulerSecretArn: this.schedulerSecret.secretArn,
      DatabaseName: this.databaseName,
      DataKeyArn: props.dataKey.keyArn,
    };
    for (const [name, value] of Object.entries(outputs))
      new CfnOutput(this, name, { value });
  }
}
